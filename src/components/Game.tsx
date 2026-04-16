import React, { useEffect, useRef, useState } from 'react';
import { Rock, Particle, GameState, Vector, Moon, LeaderboardEntry } from '../types';
import { db } from '../lib/firebase';
import { collection, query, orderBy, limit, onSnapshot, addDoc, getDocFromServer, doc } from 'firebase/firestore';
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  INITIAL_PLAYER_RADIUS,
  FRICTION,
  THRUST,
  MAX_SPEED,
  ROCK_COLORS,
  SPAWN_RATE,
  MAX_ROCKS,
  COMET_START_RADIUS,
  ASTEROID_START_RADIUS,
  SATELLITE_START_RADIUS,
  DWARF_PLANET_START_RADIUS,
} from '../constants';

const Game: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>('START');
  const [playerName, setPlayerName] = useState('');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [xp, setXp] = useState(0);
  const [maxXP, setMaxXP] = useState(2000);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ sender: string; text: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLeaderboardLoading, setIsLeaderboardLoading] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleResize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      
      // We'll handle the scaling in the draw function to maintain 16:9 aspect ratio
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Game state refs for the loop
  const playerRef = useRef<Rock & { 
    isComet?: boolean; 
    isAsteroid?: boolean; 
    isSatellite?: boolean; 
    isDwarfPlanet?: boolean; 
    cometTimer?: number;
    moons: Moon[];
  }>({
    id: 'player',
    position: { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 },
    velocity: { x: 0, y: 0 },
    radius: INITIAL_PLAYER_RADIUS,
    mass: INITIAL_PLAYER_RADIUS,
    color: '#A5A5A5', // Gray for player
    rotation: 0,
    rotationSpeed: 0.02,
    vertices: generateRockVertices(INITIAL_PLAYER_RADIUS),
    isComet: false,
    isAsteroid: false,
    isSatellite: false,
    isDwarfPlanet: false,
    cometTimer: 0,
    moons: [],
  });

  const xpRef = useRef(0);
  const rocksRef = useRef<Rock[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const rockResetTimerRef = useRef(0);
  const keysRef = useRef<{ [key: string]: boolean }>({});
  const requestRef = useRef<number>(null);
  const zoomRef = useRef(1);
  const lastSpawnTimeRef = useRef<number>(0);
  const cameraRef = useRef<Vector>({ x: 0, y: 0 });
  const chatMessagesRef = useRef<HTMLDivElement>(null);

  function generateRockVertices(radius: number): Vector[] {
    const vertices: Vector[] = [];
    const numVertices = 8 + Math.floor(Math.random() * 5);
    for (let i = 0; i < numVertices; i++) {
      const angle = (i / numVertices) * Math.PI * 2;
      const dist = radius * (0.8 + Math.random() * 0.4);
      vertices.push({
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
      });
    }
    return vertices;
  }

  function spawnRock(forceLevel?: boolean) {
    if (rocksRef.current.length >= MAX_ROCKS && !forceLevel) return;

    const player = playerRef.current;
    const isComet = player.isComet;
    const isAsteroid = player.isAsteroid;
    const isSatellite = player.isSatellite;
    const isDwarfPlanet = player.isDwarfPlanet;

    let baseMin = 10;
    let multiplier = 1.5;

    if (isDwarfPlanet) {
      baseMin = 40;
      multiplier = 2.0;
    } else if (isSatellite) {
      baseMin = 30;
      multiplier = 1.8;
    } else if (isAsteroid) {
      baseMin = 20;
      multiplier = 1.5;
    } else if (isComet) {
      baseMin = 15;
      multiplier = 1.2;
    }

    // Use Math.random() ** 2 to favor smaller rocks (quadratic distribution)
    let radius = forceLevel ? player.radius * (0.8 + Math.random() * 0.4) : baseMin + (Math.random() ** 2) * (player.radius * multiplier);
    
    // 2% chance to spawn a rock that is much larger than the player (up to 2.5x)
    if (!forceLevel && Math.random() < 0.02) {
      radius = player.radius * (1.2 + Math.random() * 1.3);
    }

    const spawnDist = Math.max(CANVAS_WIDTH, CANVAS_HEIGHT) * (0.8 + Math.random() * 0.7) * (player.radius / INITIAL_PLAYER_RADIUS);
    const angleSpawn = Math.random() * Math.PI * 2;
    const x = player.position.x + Math.cos(angleSpawn) * spawnDist;
    const y = player.position.y + Math.sin(angleSpawn) * spawnDist;

    // Point velocity towards player with some randomness
    const angleToPlayer = Math.atan2(player.position.y - y, player.position.x - x);
    const angle = angleToPlayer + (Math.random() - 0.5) * 0.8; 
    const speed = 0.3 + Math.random() * 0.8; 

    let rockIsDwarfPlanet = radius >= DWARF_PLANET_START_RADIUS;
    
    // Limit the number of Dwarf Planets in the world
    if (rockIsDwarfPlanet && !forceLevel) {
      const dwarfPlanetCount = rocksRef.current.filter(r => r.isDwarfPlanet).length;
      if (dwarfPlanetCount >= 3) {
        radius = SATELLITE_START_RADIUS + Math.random() * (DWARF_PLANET_START_RADIUS - SATELLITE_START_RADIUS - 5);
        rockIsDwarfPlanet = false;
      }
    }

    const rockIsSatellite = !rockIsDwarfPlanet && radius >= SATELLITE_START_RADIUS;
    const rockIsAsteroid = !rockIsDwarfPlanet && !rockIsSatellite && radius >= ASTEROID_START_RADIUS;
    const rockIsComet = !rockIsDwarfPlanet && !rockIsSatellite && !rockIsAsteroid && radius >= COMET_START_RADIUS;

    // If it's a tier rock, set its radius to the exact tier start size (as requested)
    if (rockIsDwarfPlanet) radius = DWARF_PLANET_START_RADIUS;
    else if (rockIsSatellite) radius = SATELLITE_START_RADIUS;
    else if (rockIsAsteroid) radius = ASTEROID_START_RADIUS;
    else if (rockIsComet) radius = COMET_START_RADIUS;

    let rockColor = ROCK_COLORS[Math.floor(Math.random() * ROCK_COLORS.length)];
    if (rockIsDwarfPlanet) rockColor = '#9370DB'; // Purple
    else if (rockIsSatellite) rockColor = '#D1D5DB'; // Moon Gray
    else if (rockIsAsteroid) rockColor = '#708090'; // Slate Gray
    else if (rockIsComet) rockColor = '#8B4513'; // Brown

    const newRock: Rock = {
      id: Math.random().toString(36).substr(2, 9),
      position: { x, y },
      velocity: {
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed,
      },
      radius,
      mass: radius,
      color: rockColor,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.02,
      vertices: generateRockVertices(radius),
      isComet: rockIsComet,
      isAsteroid: rockIsAsteroid,
      isSatellite: rockIsSatellite,
      isDwarfPlanet: rockIsDwarfPlanet,
    };

    if (forceLevel) {
      if (isDwarfPlanet) {
        newRock.isDwarfPlanet = true;
        newRock.color = player.color;
      } else if (isSatellite) {
        newRock.isSatellite = true;
        newRock.color = '#D1D5DB';
      } else if (isAsteroid) {
        newRock.isAsteroid = true;
        newRock.color = '#708090';
      } else if (isComet) {
        newRock.isComet = true;
        newRock.color = '#8B4513';
      }
    }

    rocksRef.current.push(newRock);
  }

  function createExplosion(pos: Vector, color: string, count = 20) { // Increased default count from 10 to 20
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 4; // Increased speed range
      particlesRef.current.push({
        id: Math.random().toString(36).substr(2, 9),
        position: { ...pos },
        velocity: {
          x: Math.cos(angle) * speed,
          y: Math.sin(angle) * speed,
        },
        life: 1,
        maxLife: 40 + Math.random() * 40, // Increased life from 30+30 to 40+40
        color,
        size: 3 + Math.random() * 5, // Increased size from 2+3 to 3+5
      });
    }
  }

  const evolveWorldRocks = () => {
    const player = playerRef.current;
    rocksRef.current.forEach(r => {
      // Save current tier before any changes
      const wasDwarfPlanet = r.isDwarfPlanet;
      const wasSatellite = r.isSatellite;
      const wasAsteroid = r.isAsteroid;
      const wasComet = r.isComet;
      const wasNormal = !wasDwarfPlanet && !wasSatellite && !wasAsteroid && !wasComet;

      if (r.radius > 50 || wasSatellite || wasDwarfPlanet) {
        // Evolution for large rocks or high-tier rocks
        if (wasSatellite) {
          // Moons evolve to Dwarf Planets
          r.isSatellite = false;
          r.isDwarfPlanet = true;
          r.radius = DWARF_PLANET_START_RADIUS;
          r.color = '#9370DB';
        } else if (wasDwarfPlanet) {
          // Dwarf Planets stay as Dwarf Planets but reset to start size if they were huge
          r.radius = DWARF_PLANET_START_RADIUS;
          r.color = '#9370DB';
        } else {
          // Other large rocks reset to a size appropriate for current level
          let minReset = 10;
          let maxReset = 30;
          if (player.isDwarfPlanet) { minReset = 60; maxReset = 100; }
          else if (player.isSatellite) { minReset = 60; maxReset = 90; }
          else if (player.isAsteroid) { minReset = 40; maxReset = 60; }
          else if (player.isComet) { minReset = 25; maxReset = 45; }

          r.radius = minReset + Math.random() * (maxReset - minReset);
          
          // Update flags based on new radius
          r.isDwarfPlanet = r.radius >= DWARF_PLANET_START_RADIUS;
          r.isSatellite = !r.isDwarfPlanet && r.radius >= SATELLITE_START_RADIUS;
          r.isAsteroid = !r.isDwarfPlanet && !r.isSatellite && r.radius >= ASTEROID_START_RADIUS;
          r.isComet = !r.isDwarfPlanet && !r.isSatellite && !r.isAsteroid && r.radius >= COMET_START_RADIUS;

          if (r.isDwarfPlanet) {
            r.radius = DWARF_PLANET_START_RADIUS;
            r.color = '#9370DB';
          } else if (r.isSatellite) {
            r.radius = SATELLITE_START_RADIUS;
            r.color = '#D1D5DB';
          } else if (r.isAsteroid) {
            r.radius = ASTEROID_START_RADIUS;
            r.color = '#708090';
          } else if (r.isComet) {
            r.radius = COMET_START_RADIUS;
            r.color = '#8B4513';
          } else {
            r.color = ROCK_COLORS[Math.floor(Math.random() * ROCK_COLORS.length)];
          }
        }

        r.vertices = generateRockVertices(r.radius);
        createExplosion(r.position, r.color, 5);
      } else if (r.radius < 30 || wasComet || wasAsteroid) {
        // Evolve small/medium rocks to the next tier
        if (wasNormal) {
          r.isComet = true;
          r.radius = COMET_START_RADIUS;
          r.color = '#8B4513';
        } else if (wasComet) {
          r.isComet = false;
          r.isAsteroid = true;
          r.radius = ASTEROID_START_RADIUS;
          r.color = '#708090';
        } else if (wasAsteroid) {
          r.isAsteroid = false;
          r.isSatellite = true;
          r.radius = SATELLITE_START_RADIUS;
          r.color = '#D1D5DB';
        }
        
        r.vertices = generateRockVertices(r.radius);
        createExplosion(r.position, r.color, 5);
      }
    });
  };

  const checkEvolution = () => {
    const player = playerRef.current;
    const currentXP = xpRef.current;

    if (!player.isComet && !player.isAsteroid && !player.isSatellite && !player.isDwarfPlanet && currentXP >= 2000) {
      player.isComet = true;
      player.color = '#8B4513'; // Brown
      player.radius = COMET_START_RADIUS; // Larger starting size for Comet
      player.vertices = generateRockVertices(player.radius);
      setMaxXP(5000);
      
      evolveWorldRocks();

      createExplosion(player.position, '#8B4513', 50);
      setChatMessages(prev => [...prev, { sender: 'SISTEMA', text: 'Você evoluiu para COMETA!' }]);
    } else if (player.isComet && !player.isAsteroid && currentXP >= 5000) {
      player.isAsteroid = true;
      player.color = '#708090'; // Slate Gray
      player.radius = ASTEROID_START_RADIUS; // Larger starting size for Asteroid
      player.vertices = generateRockVertices(player.radius);
      setMaxXP(10000);
      
      evolveWorldRocks();

      createExplosion(player.position, '#708090', 80);
      setChatMessages(prev => [...prev, { sender: 'SISTEMA', text: 'Você evoluiu para ASTEROIDE!' }]);
    } else if (player.isAsteroid && !player.isSatellite && currentXP >= 10000) {
      player.isSatellite = true;
      player.color = '#D1D5DB'; // Moon Gray
      player.radius = SATELLITE_START_RADIUS; // Larger starting size for Satellite
      player.vertices = generateRockVertices(player.radius);
      setMaxXP(20000);
      
      evolveWorldRocks();

      createExplosion(player.position, '#D1D5DB', 100);
      setChatMessages(prev => [...prev, { sender: 'SISTEMA', text: 'Você evoluiu para LUA!' }]);
    } else if (player.isSatellite && !player.isDwarfPlanet && currentXP >= 20000) {
      setGameState('COLOR_SELECTION');
      // The actual evolution will happen after color selection
    }
  };

  const update = () => {
    if (gameState !== 'PLAYING') return;

    const player = playerRef.current;

    // Handle Input
    if (!chatOpen) {
      const currentThrust = THRUST;
      if (keysRef.current['ArrowUp'] || keysRef.current['w'] || keysRef.current['W']) {
        player.velocity.y -= currentThrust;
      }
      if (keysRef.current['ArrowDown'] || keysRef.current['s'] || keysRef.current['S']) {
        player.velocity.y += currentThrust;
      }
      if (keysRef.current['ArrowLeft'] || keysRef.current['a'] || keysRef.current['A']) {
        player.velocity.x -= currentThrust;
      }
      if (keysRef.current['ArrowRight'] || keysRef.current['d'] || keysRef.current['D']) {
        player.velocity.x += currentThrust;
      }
    }

    // Update player rotation based on movement or just keep it spinning
    player.rotation += player.rotationSpeed;

    // Apply physics to player
    player.velocity.x *= FRICTION;
    player.velocity.y *= FRICTION;

    // Cap speed
    const currentMaxSpeed = MAX_SPEED;
    const speed = Math.sqrt(player.velocity.x ** 2 + player.velocity.y ** 2);
    if (speed > currentMaxSpeed) {
      player.velocity.x = (player.velocity.x / speed) * currentMaxSpeed;
      player.velocity.y = (player.velocity.y / speed) * currentMaxSpeed;
    }

    player.position.x += player.velocity.x;
    player.position.y += player.velocity.y;

    // Comet/Asteroid Trail
    const isMoving = keysRef.current['ArrowUp'] || keysRef.current['ArrowDown'] || keysRef.current['ArrowLeft'] || keysRef.current['ArrowRight'] || 
                     keysRef.current['w'] || keysRef.current['s'] || keysRef.current['a'] || keysRef.current['d'] ||
                     keysRef.current['W'] || keysRef.current['S'] || keysRef.current['A'] || keysRef.current['D'];
    
    if ((player.isComet || player.isAsteroid || player.isSatellite || player.isDwarfPlanet) && isMoving) {
      for (let i = 0; i < 6; i++) { // Increased from 3 to 6 particles per frame
        const trailAngle = player.rotation + Math.PI + (Math.random() - 0.5) * 0.8;
        const trailSpeed = 1 + Math.random() * 4; // Increased speed range
        
        let trailColor = '#FF4500'; // Default orange
        if (player.isDwarfPlanet) {
          trailColor = Math.random() > 0.3 ? '#9370DB' : '#FFFFFF'; // Purple/White for Dwarf Planet
        } else if (player.isSatellite) {
          trailColor = Math.random() > 0.3 ? '#D1D5DB' : '#FFFFFF'; // Moon Gray / White
        } else if (player.isComet && !player.isAsteroid) {
          trailColor = Math.random() > 0.3 ? '#00BFFF' : '#1E90FF'; // Blue for Comet
        } else {
          trailColor = Math.random() > 0.3 ? '#FF4500' : '#FFA500'; // Orange for Asteroid
        }

        particlesRef.current.push({
          id: Math.random().toString(36).substr(2, 9),
          position: { ...player.position },
          velocity: {
            x: Math.cos(trailAngle) * trailSpeed,
            y: Math.sin(trailAngle) * trailSpeed,
          },
          life: 0,
          maxLife: 20 + Math.random() * 20, // Increased life from 15+15 to 20+20
          color: trailColor,
          size: 3 + Math.random() * 6, // Increased size from 2+5 to 3+6
        });
      }
    }

    // Update Moons
    player.moons.forEach(moon => {
      moon.orbitAngle += moon.orbitSpeed;
      
      // Ensure moon stays outside player radius if player grows
      const minOrbit = player.radius + moon.radius + 10;
      if (moon.orbitRadius < minOrbit) {
        moon.orbitRadius = minOrbit;
      }

      moon.position.x = player.position.x + Math.cos(moon.orbitAngle) * moon.orbitRadius;
      moon.position.y = player.position.y + Math.sin(moon.orbitAngle) * moon.orbitRadius;
      moon.rotation += moon.rotationSpeed;

      // Moon Trails
      if (moon.isComet || moon.isAsteroid || moon.isSatellite || moon.isDwarfPlanet) {
        if (Math.random() > 0.5) {
          const trailAngle = moon.rotation + Math.PI + (Math.random() - 0.5) * 0.8;
          const trailSpeed = 0.5 + Math.random() * 2;
          
          let trailColor = '#FF4500';
          if (moon.isDwarfPlanet) trailColor = Math.random() > 0.3 ? '#9370DB' : '#FFFFFF';
          else if (moon.isSatellite) trailColor = Math.random() > 0.3 ? '#D1D5DB' : '#FFFFFF';
          else if (moon.isComet) trailColor = Math.random() > 0.3 ? '#00BFFF' : '#1E90FF';
          else if (moon.isAsteroid) trailColor = Math.random() > 0.3 ? '#FF4500' : '#FFA500';

          particlesRef.current.push({
            id: Math.random().toString(36).substr(2, 9),
            position: { ...moon.position },
            velocity: {
              x: Math.cos(trailAngle) * trailSpeed,
              y: Math.sin(trailAngle) * trailSpeed,
            },
            life: 0,
            maxLife: 10 + Math.random() * 10,
            color: trailColor,
            size: 1 + Math.random() * 2,
          });
        }
      }
    });

    // Update camera to follow player
    cameraRef.current.x = player.position.x - CANVAS_WIDTH / 2;
    cameraRef.current.y = player.position.y - CANVAS_HEIGHT / 2;

    // Moon-Rock Collision
    for (let m = player.moons.length - 1; m >= 0; m--) {
      const moon = player.moons[m];
      let moonDestroyed = false;

      for (let i = rocksRef.current.length - 1; i >= 0; i--) {
        const rock = rocksRef.current[i];
        const dx = moon.position.x - rock.position.x;
        const dy = moon.position.y - rock.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < moon.radius + rock.radius) {
          if (moon.radius >= rock.radius) {
            // Moon destroys rock
            createExplosion(rock.position, rock.color, 10);
            rocksRef.current.splice(i, 1);
            setScore(s => s + Math.floor(rock.radius / 2));
          } else {
            // Rock destroys moon
            createExplosion(moon.position, moon.color, 20);
            player.moons.splice(m, 1);
            setChatMessages(prev => [...prev, { sender: 'SISTEMA', text: 'Sua lua foi destruída!' }]);
            moonDestroyed = true;
            break; 
          }
        }
      }
      if (moonDestroyed) continue;
    }

    // Automatic Evolution Check
    checkEvolution();

    // Update Rocks
    const playerPos = { ...player.position };
    for (let i = rocksRef.current.length - 1; i >= 0; i--) {
      const rock = rocksRef.current[i];
      const prevPos = { ...rock.position };
      rock.position.x += rock.velocity.x;
      rock.position.y += rock.velocity.y;
      rock.rotation += rock.rotationSpeed;

      // Special Rock Trails - Improved for continuity
      if (rock.isComet || rock.isAsteroid || rock.isSatellite || rock.isDwarfPlanet) {
        const distMoved = Math.sqrt(Math.pow(rock.position.x - prevPos.x, 2) + Math.pow(rock.position.y - prevPos.y, 2));
        const steps = Math.max(1, Math.floor(distMoved / 5));
        
        for (let s = 0; s < steps; s++) {
          if (Math.random() > 0.3) {
            const lerp = s / steps;
            const trailAngle = rock.rotation + Math.PI + (Math.random() - 0.5) * 0.8;
            const trailSpeed = 0.5 + Math.random() * 2;
            
            let trailColor = '#FF4500';
            if (rock.isDwarfPlanet) trailColor = Math.random() > 0.3 ? '#9370DB' : '#FFFFFF';
            else if (rock.isSatellite) trailColor = Math.random() > 0.3 ? '#D1D5DB' : '#FFFFFF';
            else if (rock.isComet) trailColor = Math.random() > 0.3 ? '#00BFFF' : '#1E90FF';
            else if (rock.isAsteroid) trailColor = Math.random() > 0.3 ? '#FF4500' : '#FFA500';

            particlesRef.current.push({
              id: Math.random().toString(36).substr(2, 9),
              position: { 
                x: prevPos.x + (rock.position.x - prevPos.x) * lerp, 
                y: prevPos.y + (rock.position.y - prevPos.y) * lerp 
              },
              velocity: {
                x: Math.cos(trailAngle) * trailSpeed + rock.velocity.x * 0.5,
                y: Math.sin(trailAngle) * trailSpeed + rock.velocity.y * 0.5,
              },
              life: 0,
              maxLife: 10 + Math.random() * 10,
              color: trailColor,
              size: 1 + Math.random() * 3,
            });
          }
        }
      }

      // Reposition rocks if they are too far from the player
      const dxPlayer = rock.position.x - player.position.x;
      const dyPlayer = rock.position.y - player.position.y;
      const distToPlayer = Math.sqrt(dxPlayer * dxPlayer + dyPlayer * dyPlayer);
      const maxDist = Math.max(CANVAS_WIDTH, CANVAS_HEIGHT) * 1.2;

      if (distToPlayer > maxDist) {
        // Move rock to the other side of the player
        const angle = Math.atan2(dyPlayer, dxPlayer) + Math.PI + (Math.random() - 0.5) * 0.5;
        rock.position.x = player.position.x + Math.cos(angle) * maxDist;
        rock.position.y = player.position.y + Math.sin(angle) * maxDist;

        // Update velocity to point towards player again
        const newAngleToPlayer = Math.atan2(player.position.y - rock.position.y, player.position.x - rock.position.x);
        const speed = 0.3 + Math.random() * 0.6; // Increased from 0.2 + random * 0.4
        rock.velocity.x = Math.cos(newAngleToPlayer + (Math.random() - 0.5) * 0.8) * speed;
        rock.velocity.y = Math.sin(newAngleToPlayer + (Math.random() - 0.5) * 0.8) * speed;
      }

      // Collision with player
      const dx = rock.position.x - player.position.x;
      const dy = rock.position.y - player.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < player.radius + rock.radius) {
        let eatMultiplier = 1.05; // Base multiplier: can eat things slightly larger
        if (player.isDwarfPlanet) eatMultiplier = 1.3; 
        else if (player.isSatellite) eatMultiplier = 1.2; 
        else if (player.isAsteroid) eatMultiplier = 1.15; 
        else if (player.isComet) eatMultiplier = 1.1; 

        // Special rule: if player is diameter 20-21, it doesn't lose to rocks of diameter 20-21
        const isSmallPlayer = player.radius <= 10.5;
        const isSmallRock = rock.radius <= 10.5;

        if (player.radius * eatMultiplier >= rock.radius || (isSmallPlayer && isSmallRock)) {
          // Merge
          const area1 = Math.PI * player.radius * player.radius;
          const area2 = Math.PI * rock.radius * rock.radius;
          const newArea = area1 + area2;
          player.radius = Math.sqrt(newArea / Math.PI);
          player.vertices = generateRockVertices(player.radius);
          
          setScore(s => s + Math.floor(rock.radius));
          
          // Update XP
          let currentMaxXP = 2000;
          if (player.isDwarfPlanet) currentMaxXP = 20000; // Keep it at max
          else if (player.isSatellite) currentMaxXP = 20000;
          else if (player.isAsteroid) currentMaxXP = 10000;
          else if (player.isComet) currentMaxXP = 5000;
          
          if (!player.isDwarfPlanet) {
            let xpGain = Math.floor(rock.radius * 4); // Proportional to size (radius)

            // More XP in higher tiers to balance the higher max XP requirements
            if (player.isSatellite) xpGain *= 3;
            else if (player.isAsteroid) xpGain *= 2;
            else if (player.isComet) xpGain *= 1.5;
            
            xpRef.current = Math.min(currentMaxXP, xpRef.current + xpGain);
            setXp(xpRef.current);
          }

          createExplosion(rock.position, rock.color);
          rocksRef.current.splice(i, 1);
        } else {
          // Game Over
          setGameState('GAMEOVER');
          createExplosion(player.position, player.color, 30);
        }
      }
    }

    // Rock-Rock Collision
    for (let i = rocksRef.current.length - 1; i >= 0; i--) {
      for (let j = i - 1; j >= 0; j--) {
        const r1 = rocksRef.current[i];
        const r2 = rocksRef.current[j];
        if (!r1 || !r2) continue;

        const dx = r1.position.x - r2.position.x;
        const dy = r1.position.y - r2.position.y;
        const distSq = dx * dx + dy * dy;
        const radSum = r1.radius + r2.radius;

        if (distSq < radSum * radSum) {
          // Special rule: diameter 20 (radius 10) doesn't lose to diameter 20 or 21 (radius 10.5)
          if (r1.radius <= 10.5 && r2.radius <= 10.5) {
            continue;
          }

          const larger = r1.radius >= r2.radius ? r1 : r2;
          const smaller = r1.radius >= r2.radius ? r2 : r1;
          const smallerIndex = r1.radius >= r2.radius ? j : i;

          const area1 = Math.PI * larger.radius * larger.radius;
          const area2 = Math.PI * smaller.radius * smaller.radius;
          larger.radius = Math.sqrt((area1 + area2) / Math.PI);
          
          // Update flags based on new radius
          larger.isDwarfPlanet = larger.radius >= DWARF_PLANET_START_RADIUS;
          larger.isSatellite = !larger.isDwarfPlanet && larger.radius >= SATELLITE_START_RADIUS;
          larger.isAsteroid = !larger.isDwarfPlanet && !larger.isSatellite && larger.radius >= ASTEROID_START_RADIUS;
          larger.isComet = !larger.isDwarfPlanet && !larger.isSatellite && !larger.isAsteroid && larger.radius >= COMET_START_RADIUS;

          if (larger.isDwarfPlanet) larger.color = '#9370DB';
          else if (larger.isSatellite) larger.color = '#D1D5DB';
          else if (larger.isAsteroid) larger.color = '#708090';
          else if (larger.isComet) larger.color = '#8B4513';

          // Cap/Reset rock if it gets too big (max 1000)
          if (larger.radius > 1000) {
            larger.radius = 250;
            // Update flags based on new radius (250 is still a Dwarf Planet)
            larger.isDwarfPlanet = true;
            larger.isSatellite = false;
            larger.isAsteroid = false;
            larger.isComet = false;
            larger.color = '#9370DB';
            createExplosion(larger.position, '#fff', 30);
          }

          larger.vertices = generateRockVertices(larger.radius);
          larger.mass = larger.radius;

          createExplosion(smaller.position, smaller.color, 5);
          rocksRef.current.splice(smallerIndex, 1);
          
          if (smallerIndex === i) {
            break;
          }
        }
      }
    }

    // Periodic reset removed as per user request
    // Only reset when reaching size 1000 in collisions

    // Spawn new rocks (exactly 8 per second)
    const now = performance.now();
    if (now - lastSpawnTimeRef.current > 1000 / SPAWN_RATE) {
      // Check if we have at least 5 rocks of the player's level
      let levelCount = 0;
      rocksRef.current.forEach(r => {
        if (player.isDwarfPlanet && r.isDwarfPlanet) levelCount++;
        else if (player.isSatellite && r.isSatellite) levelCount++;
        else if (player.isAsteroid && r.isAsteroid) levelCount++;
        else if (player.isComet && r.isComet) levelCount++;
        else if (!player.isComet && !player.isAsteroid && !player.isSatellite && !player.isDwarfPlanet && !r.isComet && !r.isAsteroid && !r.isSatellite && !r.isDwarfPlanet) levelCount++;
      });

      if (levelCount < 5) {
        spawnRock(true);
      } else {
        spawnRock();
      }
      lastSpawnTimeRef.current = now;
    }

    // Update particles
    particlesRef.current = particlesRef.current.filter(p => {
      p.position.x += p.velocity.x;
      p.position.y += p.velocity.y;
      p.life++;
      return p.life < p.maxLife;
    });
  };

  const draw = (ctx: CanvasRenderingContext2D) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const screenWidth = rect.width;
    const screenHeight = rect.height;

    // Calculate scale to fit 1920x1080 into the current screen size
    const scaleX = screenWidth / CANVAS_WIDTH;
    const scaleY = screenHeight / CANVAS_HEIGHT;
    const fitScale = Math.min(scaleX, scaleY);

    // Clear the whole canvas (including bars)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Center and scale the context for the game world
    ctx.setTransform(fitScale * dpr, 0, 0, fitScale * dpr, (screenWidth - CANVAS_WIDTH * fitScale) / 2 * dpr, (screenHeight - CANVAS_HEIGHT * fitScale) / 2 * dpr);

    const camX = cameraRef.current.x;
    const camY = cameraRef.current.y;
    const player = playerRef.current;

    // Calculate zoom factor: player should be roughly 10-15% of screen height
    const targetZoom = Math.min(1, (INITIAL_PLAYER_RADIUS * 6) / player.radius);
    zoomRef.current += (targetZoom - zoomRef.current) * 0.05;
    const zoom = zoomRef.current;

    // Draw Background (Game World)
    ctx.fillStyle = '#050505'; // Slightly lighter black for the world
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Parallax Stars (Distant)
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    const distantStarGrid = 400;
    const dsStartX = Math.floor((camX * 0.2 - CANVAS_WIDTH) / distantStarGrid) * distantStarGrid;
    const dsStartY = Math.floor((camY * 0.2 - CANVAS_HEIGHT) / distantStarGrid) * distantStarGrid;
    
    for (let gx = dsStartX; gx <= dsStartX + CANVAS_WIDTH * 2; gx += distantStarGrid) {
      for (let gy = dsStartY; gy <= dsStartY + CANVAS_HEIGHT * 2; gy += distantStarGrid) {
        const seed = (gx * 17 + gy * 11) % 100;
        const sx = gx + (Math.abs(Math.sin(seed)) * distantStarGrid) - camX * 0.2;
        const sy = gy + (Math.abs(Math.cos(seed)) * distantStarGrid) - camY * 0.2;
        ctx.fillRect(sx, sy, 1, 1);
      }
    }
    ctx.restore();

    ctx.save();
    // Center the zoom on the screen
    ctx.translate(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-camX - CANVAS_WIDTH / 2, -camY - CANVAS_HEIGHT / 2);

    // Background stars (Closer parallax)
    ctx.fillStyle = 'white';
    const starGridSize = 300;
    const startX = Math.floor((camX - CANVAS_WIDTH / zoom) / starGridSize) * starGridSize;
    const startY = Math.floor((camY - CANVAS_HEIGHT / zoom) / starGridSize) * starGridSize;
    const endX = Math.ceil((camX + CANVAS_WIDTH / zoom) / starGridSize) * starGridSize;
    const endY = Math.ceil((camY + CANVAS_HEIGHT / zoom) / starGridSize) * starGridSize;

    for (let gx = startX; gx <= endX; gx += starGridSize) {
      for (let gy = startY; gy <= endY; gy += starGridSize) {
        const seed = (gx * 13 + gy * 7) % 100;
        const sx = gx + (Math.abs(Math.sin(seed)) * starGridSize);
        const sy = gy + (Math.abs(Math.cos(seed)) * starGridSize);
        const starSize = (1 + (Math.abs(Math.sin(seed * 2)) * 2)) / zoom;
        ctx.fillRect(sx, sy, starSize, starSize);
      }
    }

    // Draw Particles
    particlesRef.current.forEach(p => {
      ctx.globalAlpha = 1 - p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.position.x, p.position.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Draw Rocks
    rocksRef.current.forEach(rock => {
      ctx.save();
      ctx.translate(rock.position.x, rock.position.y);
      ctx.rotate(rock.rotation);
      
      // Special rendering for evolved rocks
      if (rock.isAsteroid && !rock.isSatellite && !rock.isDwarfPlanet) {
        ctx.scale(1.4, 0.7);
      }

      // Glow effect for rocks - Optimized
      if (zoom > 0.3) {
        ctx.shadowBlur = (rock.isComet || rock.isAsteroid || rock.isSatellite || rock.isDwarfPlanet ? 20 : 10) / zoom;
        ctx.shadowColor = rock.color;
      }
      
      ctx.fillStyle = rock.color;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 / zoom;

      if (rock.isDwarfPlanet || rock.isSatellite) {
        ctx.beginPath();
        ctx.arc(0, 0, rock.radius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        if (rock.isSatellite) {
          // Draw Craters for satellite rocks
          ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
          const craterPositions = [
            { x: -0.4, y: -0.3, r: 0.2 },
            { x: 0.2, y: -0.5, r: 0.15 },
            { x: 0.5, y: 0.2, r: 0.25 },
          ];
          craterPositions.forEach(c => {
            ctx.beginPath();
            ctx.arc(c.x * rock.radius, c.y * rock.radius, c.r * rock.radius, 0, Math.PI * 2);
            ctx.fill();
          });
        }
      } else {
        ctx.beginPath();
        ctx.moveTo(rock.vertices[0].x, rock.vertices[0].y);
        for (let i = 1; i < rock.vertices.length; i++) {
          ctx.lineTo(rock.vertices[i].x, rock.vertices[i].y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    });

    // Draw Moons
    player.moons.forEach(moon => {
      ctx.save();
      ctx.translate(moon.position.x, moon.position.y);
      ctx.rotate(moon.rotation);
      ctx.fillStyle = moon.color;
      
      // Moon glow - Optimized
      if (zoom > 0.3) {
        ctx.shadowBlur = 15 / zoom;
        ctx.shadowColor = moon.color;
      }

      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1 / zoom;

      ctx.beginPath();
      ctx.moveTo(moon.vertices[0].x, moon.vertices[0].y);
      for (let i = 1; i < moon.vertices.length; i++) {
        ctx.lineTo(moon.vertices[i].x, moon.vertices[i].y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });

    // Draw Player
    if (gameState !== 'GAMEOVER') {
      ctx.save();
      ctx.translate(player.position.x, player.position.y);
      ctx.rotate(player.rotation);
      
      // Flatten Asteroid
      if (player.isAsteroid && !player.isSatellite && !player.isDwarfPlanet) {
        ctx.scale(1.4, 0.7); // Flattened shape
      }

      // Glow effect for player - Optimized
      if (zoom > 0.3) {
        ctx.shadowBlur = 25 / zoom;
        ctx.shadowColor = player.color;
      }

      ctx.fillStyle = player.color;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 / zoom;
      
      if (player.isDwarfPlanet) {
        ctx.beginPath();
        // Perfect Circle for Dwarf Planet
        ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
        ctx.closePath();
      } else if (player.isSatellite) {
        ctx.beginPath();
        // Full Moon Circle
        ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Draw Craters
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        const craterPositions = [
          { x: -0.4, y: -0.3, r: 0.2 },
          { x: 0.2, y: -0.5, r: 0.15 },
          { x: 0.5, y: 0.2, r: 0.25 },
          { x: -0.2, y: 0.5, r: 0.18 },
          { x: -0.6, y: 0.1, r: 0.12 },
        ];
        craterPositions.forEach(c => {
          ctx.beginPath();
          ctx.arc(c.x * player.radius, c.y * player.radius, c.r * player.radius, 0, Math.PI * 2);
          ctx.fill();
        });
      } else {
        ctx.beginPath();
        ctx.moveTo(player.vertices[0].x, player.vertices[0].y);
        for (let i = 1; i < player.vertices.length; i++) {
          ctx.lineTo(player.vertices[i].x, player.vertices[i].y);
        }
        ctx.closePath();
      }
      
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  };

  const loop = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    update();
    draw(ctx);
    requestRef.current = requestAnimationFrame(loop);
  };

  // Load saved data on mount
  useEffect(() => {
    const savedName = localStorage.getItem('rockInSpace_playerName');
    if (savedName) setPlayerName(savedName);
    
    const savedHighScore = localStorage.getItem('rockInSpace_highScore');
    if (savedHighScore) setHighScore(parseInt(savedHighScore) || 0);

    const savedLeaderboard = localStorage.getItem('rockInSpace_leaderboard');
    if (savedLeaderboard) {
      try {
        setLeaderboard(JSON.parse(savedLeaderboard));
      } catch (e) {
        console.error('Failed to parse leaderboard', e);
      }
    }

    // Test connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'leaderboard', 'connection-test'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Erro de conexão com o Firebase. Verifique a configuração.");
        }
      }
    };
    testConnection();

    // Global Leaderboard from Firestore
    const q = query(collection(db, 'leaderboard'), orderBy('score', 'desc'), limit(5));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const entries: LeaderboardEntry[] = [];
      snapshot.forEach((doc) => {
        entries.push(doc.data() as LeaderboardEntry);
      });
      setLeaderboard(entries);
      setIsLeaderboardLoading(false);
    }, (error) => {
      console.error("Erro ao carregar ranking global:", error);
      setIsLeaderboardLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Persist high score
  useEffect(() => {
    if (score > highScore) {
      setHighScore(score);
      localStorage.setItem('rockInSpace_highScore', score.toString());
    }
  }, [score, highScore]);

  useEffect(() => {
    if (gameState === 'GAMEOVER' && score > 0) {
      const name = playerName || 'ANÔNIMO';
      const date = new Date().toLocaleDateString('pt-BR');
      
      // Save to Local for fallback
      const localEntry: LeaderboardEntry = { name, score, date };
      const savedLocal = localStorage.getItem('rockInSpace_leaderboard');
      let localLeaderboard: LeaderboardEntry[] = savedLocal ? JSON.parse(savedLocal) : [];
      localLeaderboard.push(localEntry);
      localLeaderboard.sort((a, b) => b.score - a.score);
      localLeaderboard = localLeaderboard.slice(0, 5);
      localStorage.setItem('rockInSpace_leaderboard', JSON.stringify(localLeaderboard));

      // Save to Firestore (Global)
      addDoc(collection(db, 'leaderboard'), {
        name,
        score,
        date,
        timestamp: Date.now() // Using simple timestamp for sorting
      }).catch(err => console.error("Erro ao salvar no ranking global:", err));
    }
  }, [gameState, score, playerName]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(loop);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameState]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'r' && gameState === 'PLAYING') {
        setChatOpen(prev => !prev);
        return;
      }
      
      if (chatOpen) return;
      keysRef.current[e.key] = true;
    };
    const handleMouseDown = (e: MouseEvent) => {
      if (gameState !== 'PLAYING' || chatOpen) return;
      if (e.button !== 0) return; // Left click only

      const player = playerRef.current;
      if (!player.isDwarfPlanet) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const screenWidth = rect.width;
      const screenHeight = rect.height;
      const scaleX = screenWidth / CANVAS_WIDTH;
      const scaleY = screenHeight / CANVAS_HEIGHT;
      const fitScale = Math.min(scaleX, scaleY);

      // Offset from the centered game area
      const offsetX = (screenWidth - CANVAS_WIDTH * fitScale) / 2;
      const offsetY = (screenHeight - CANVAS_HEIGHT * fitScale) / 2;

      // Mouse position relative to the 1920x1080 virtual resolution
      const mouseX = (e.clientX - rect.left - offsetX) / fitScale;
      const mouseY = (e.clientY - rect.top - offsetY) / fitScale;

      // Mouse position in world space considering zoom and camera
      const zoom = zoomRef.current;
      const worldMouseX = player.position.x + (mouseX - CANVAS_WIDTH / 2) / zoom;
      const worldMouseY = player.position.y + (mouseY - CANVAS_HEIGHT / 2) / zoom;

      // Find if we clicked a rock
      for (let i = 0; i < rocksRef.current.length; i++) {
        const rock = rocksRef.current[i];
        const dx = worldMouseX - rock.position.x;
        const dy = worldMouseY - rock.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < rock.radius) {
          // Check size: rock must be at least 25% smaller than player
          if (rock.radius <= player.radius * 0.75) {
            if (player.moons.length >= 1) {
              setChatMessages(prev => [...prev, { sender: 'SISTEMA', text: 'Você já possui uma lua!' }]);
              break;
            }
            // Turn into moon
            const moonRadius = rock.radius / 4;
            const newMoon: Moon = {
              ...rock,
              radius: moonRadius,
              vertices: generateRockVertices(moonRadius),
              orbitRadius: player.radius + moonRadius + 30 + Math.random() * 200,
              orbitAngle: Math.atan2(rock.position.y - player.position.y, rock.position.x - player.position.x),
              orbitSpeed: (0.003 + Math.random() * 0.01) * (Math.random() > 0.5 ? 1 : -1),
            };
            player.moons.push(newMoon);
            rocksRef.current.splice(i, 1);
            createExplosion(rock.position, rock.color, 15);
            setChatMessages(prev => [...prev, { sender: 'SISTEMA', text: 'Nova lua capturada!' }]);
            break;
          } else {
            setChatMessages(prev => [...prev, { sender: 'SISTEMA', text: 'Esta pedra é muito grande!' }]);
            break;
          }
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => (keysRef.current[e.key] = false);
    const handleBlur = () => {
      // Clear all keys on blur to prevent stuck movement
      Object.keys(keysRef.current).forEach(key => {
        keysRef.current[key] = false;
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('blur', handleBlur);
    };
  }, [gameState, chatOpen]);

  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const startGame = () => {
    if (playerName.trim()) {
      confirmName();
    } else {
      setGameState('NAME_ENTRY');
    }
  };

  const confirmName = () => {
    if (playerName.trim()) {
      localStorage.setItem('rockInSpace_playerName', playerName.trim().toUpperCase());
    }
    cameraRef.current = { x: 0, y: 0 };
    playerRef.current = {
      id: 'player',
      position: { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 },
      velocity: { x: 0, y: 0 },
      radius: INITIAL_PLAYER_RADIUS,
      mass: INITIAL_PLAYER_RADIUS,
      color: '#A5A5A5',
      rotation: 0,
      rotationSpeed: 0.01, // Reduced from 0.02
      vertices: generateRockVertices(INITIAL_PLAYER_RADIUS),
      isComet: false,
      isAsteroid: false,
      isSatellite: false,
      isDwarfPlanet: false,
      cometTimer: 0,
      moons: [],
    };
    rocksRef.current = [];
    particlesRef.current = [];
    setScore(0);
    setXp(0);
    setMaxXP(2000);
    xpRef.current = 0;
    setGameState('PLAYING');
    setChatMessages([{ sender: 'SISTEMA', text: `Bem-vindo ao espaço, ${playerName || 'Viajante'}!` }]);
    
    // Initial spawn
    for(let i=0; i<10; i++) spawnRock();
    for(let i=0; i<5; i++) spawnRock(true);
  };

  const sendChatMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    
    const morphMatch = chatInput.match(/^\/\/\/\.\.\.\/\/\/(.*)\/\/\/\.\.\.\/\/\/$/i);
    const xpMatch = chatInput.match(/^\/\.\/\.\/\/\.?(.*?)\.?\.\/\.\/\.\.$/i);

    if (morphMatch) {
      const target = morphMatch[1].trim().toUpperCase();
      const player = playerRef.current;
      let success = true;

      // Reset all flags first
      player.isComet = false;
      player.isAsteroid = false;
      player.isSatellite = false;
      player.isDwarfPlanet = false;

      if (target === 'COMETA') {
        player.isComet = true;
        player.color = '#8B4513';
        player.radius = COMET_START_RADIUS;
        xpRef.current = 2000;
        setMaxXP(5000);
      } else if (target === 'ASTEROIDE') {
        player.isAsteroid = true;
        player.color = '#708090';
        player.radius = ASTEROID_START_RADIUS;
        xpRef.current = 5000;
        setMaxXP(10000);
      } else if (target === 'LUA') {
        player.isSatellite = true;
        player.color = '#D1D5DB'; // Moon Gray
        player.radius = SATELLITE_START_RADIUS;
        xpRef.current = 10000;
        setMaxXP(20000);
      } else if (target === 'PLANETA' || target === 'PLANETA ANAO' || target === 'PLANETA ANÃO' || target === 'ANÃO' || target === 'ANAO' || target === 'PLANETAANAO' || target === 'PLANETAANÃO') {
        player.isDwarfPlanet = true;
        player.radius = DWARF_PLANET_START_RADIUS;
        xpRef.current = 20000;
        setGameState('COLOR_SELECTION');
      } else if (target === 'PEDRA') {
        player.color = '#A5A5A5';
        player.radius = INITIAL_PLAYER_RADIUS;
        xpRef.current = 0;
        setMaxXP(2000);
      } else if (target === 'MORTE') {
        setGameState('GAMEOVER');
        createExplosion(player.position, player.color, 30);
      } else if (!isNaN(Number(target))) {
        player.radius = Math.max(5, Math.min(500, Number(target)));
      } else {
        success = false;
      }

      if (success) {
        setXp(xpRef.current);
        player.vertices = generateRockVertices(player.radius);
        evolveWorldRocks();
        setChatMessages(prev => [...prev, { sender: 'SISTEMA', text: `Você se transformou em: ${target}!` }]);
      } else {
        setChatMessages(prev => [...prev, { sender: 'SISTEMA', text: `Transformação "${target}" não reconhecida.` }]);
      }
    } else if (xpMatch) {
      const rawValue = xpMatch[1].trim().toLowerCase().replace('xp', '');
      const targetXP = Number(rawValue);
      if (!isNaN(targetXP)) {
        xpRef.current = Math.max(0, targetXP);
        setXp(xpRef.current);
        checkEvolution();
        setChatMessages(prev => [...prev, { sender: 'SISTEMA', text: `XP definido para: ${xpRef.current}!` }]);
      } else {
        setChatMessages(prev => [...prev, { sender: 'SISTEMA', text: `Valor de XP "${xpMatch[1]}" inválido.` }]);
      }
    } else {
      setChatMessages(prev => [...prev, { sender: playerName || 'Você', text: chatInput }]);
    }
    
    setChatInput('');
    setChatOpen(false);
  };

  const handleColorSelect = (color: string) => {
    const player = playerRef.current;
    player.isDwarfPlanet = true;
    player.color = color;
    player.radius = DWARF_PLANET_START_RADIUS; // Slightly smaller starting size for Dwarf Planet
    player.vertices = generateRockVertices(player.radius);
    
    xpRef.current = 20000;
    setXp(20000);
    setMaxXP(20000);

    // Reset existing large rocks to a size appropriate for Dwarf Planet
    rocksRef.current.forEach(r => {
      if (r.radius > 40) {
        r.radius = 60 + Math.random() * 40;
        r.vertices = generateRockVertices(r.radius);
      }
    });

    createExplosion(player.position, color, 150);
    evolveWorldRocks();
    setGameState('PLAYING');
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden flex items-center justify-center font-mono">
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="w-full h-full object-contain"
      />

      {/* UI Overlay */}
      <div className="absolute top-8 left-8 text-white pointer-events-none flex flex-col gap-4">
        <div className="flex flex-col">
          <div className="text-2xl tracking-tighter opacity-50 uppercase italic font-black">Rock in Space</div>
          {playerName && <div className="text-xl font-black uppercase tracking-widest text-yellow-400 drop-shadow-md">{playerName}</div>}
        </div>
        
        {/* XP Bar */}
        <div className="w-64 h-4 bg-white/20 rounded-full overflow-hidden border border-white/30 backdrop-blur-sm relative">
          <div 
            className={`h-full transition-all duration-300 ${playerRef.current.isDwarfPlanet ? 'bg-purple-500 shadow-[0_0_20px_rgba(147,112,219,1)]' : playerRef.current.isSatellite ? 'bg-slate-300 shadow-[0_0_15px_rgba(200,200,200,0.8)]' : playerRef.current.isAsteroid ? 'bg-orange-500 shadow-[0_0_15px_rgba(255,69,0,0.8)]' : playerRef.current.isComet ? 'bg-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.8)]' : 'bg-yellow-400'}`}
            style={{ width: `${(xp / maxXP) * 100}%` }}
          />
          <div className="absolute inset-0 flex items-center justify-center text-[10px] font-black uppercase tracking-widest mix-blend-difference text-white">
            {playerRef.current.isDwarfPlanet ? 'PLANETA ANÃO' : playerRef.current.isSatellite ? 'LUA' : playerRef.current.isAsteroid ? 'ASTEROIDE' : playerRef.current.isComet ? 'COMETA' : 'PEDRA'} | {Math.floor(xp)} / {maxXP}
          </div>
        </div>

        <div className="text-[10px] opacity-30 uppercase font-black tracking-widest">
          WASD ou Setas para mover • R para Chat
        </div>
      </div>

      <div className="absolute top-8 right-8 text-white pointer-events-none flex flex-col items-end gap-1">
        <div className="text-sm opacity-50 uppercase font-black">Recorde: {highScore}</div>
        <div className="text-4xl font-black italic tracking-tighter">{score}</div>
      </div>

      {gameState === 'START' && (
        <div 
          className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white p-8 text-center"
        >
          <div className="flex flex-row items-center justify-center gap-16 w-full max-w-6xl">
            <div className="flex flex-col gap-6 items-center">
              <h1 className="text-9xl font-black uppercase tracking-tighter mb-4 italic drop-shadow-2xl">Rock in Space</h1>
              <button
                onClick={startGame}
                className="px-10 py-3 bg-white text-black font-bold text-xl hover:bg-yellow-400 transition-colors uppercase skew-x-[-10deg] w-48 shadow-[6px_6px_0px_0px_rgba(255,255,255,0.2)]"
              >
                {playerName ? 'Jogar' : 'Início'}
              </button>

              {playerName && (
                <button
                  onClick={() => setGameState('NAME_ENTRY')}
                  className="text-sm opacity-50 hover:opacity-100 transition-opacity uppercase font-black mt-2"
                >
                  Trocar Nome
                </button>
              )}
            </div>

            <div className="w-full max-w-sm min-h-[450px] bg-white text-black p-6 rounded-sm shadow-[8px_8px_0px_0px_rgba(255,255,255,0.2)] skew-x-[-2deg] flex flex-col">
              <h2 className="text-2xl font-black uppercase tracking-tighter mb-6 italic border-b-4 border-black pb-2">Ranking Global</h2>
              
              <div className="flex-grow">
                {isLeaderboardLoading ? (
                  <div className="text-xs opacity-50 animate-pulse uppercase font-black py-8">Sincronizando satélites...</div>
                ) : leaderboard.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    {leaderboard.map((entry, i) => (
                      <div key={i} className="flex justify-between items-center border-b-2 border-black/10 pb-2 last:border-0">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-black opacity-30">{i + 1}º</span>
                          <span className="font-black uppercase tracking-tight text-lg">{entry.name}</span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-2xl font-black italic leading-none">{entry.score}</span>
                          <span className="text-[10px] opacity-50 uppercase font-bold">{entry.date}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs opacity-50 uppercase font-black py-8">Nenhum sinal detectado. Estabeleça o primeiro recorde!</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {gameState === 'NAME_ENTRY' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md text-white p-8 text-center">
          <h1 className="text-6xl font-black uppercase tracking-tighter mb-8 italic">Qual seu nome?</h1>
          <div className="flex flex-col gap-6 w-full max-w-md">
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value.toUpperCase())}
              placeholder="DIGITE SEU NOME..."
              maxLength={15}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && confirmName()}
              className="bg-white/10 border-b-4 border-white p-4 text-3xl font-black uppercase tracking-widest text-center focus:outline-none focus:bg-white/20 transition-all placeholder:text-white/20"
            />
            <button
              onClick={confirmName}
              disabled={!playerName.trim()}
              className="px-12 py-4 bg-white text-black font-bold text-2xl hover:bg-yellow-400 disabled:opacity-50 disabled:hover:bg-white transition-colors uppercase skew-x-[-10deg]"
            >
              Confirmar
            </button>
          </div>
        </div>
      )}

      {gameState === 'GAMEOVER' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-900/40 backdrop-blur-sm text-white p-8 text-center">
          <h1 className="text-9xl font-black uppercase tracking-tighter mb-2 italic">DESTRUÍDO</h1>
          <div className="flex flex-col gap-4">
            <button
              onClick={startGame}
              className="px-12 py-4 bg-white text-black font-bold text-2xl hover:bg-yellow-400 transition-colors uppercase skew-x-[-10deg]"
            >
              Continuar
            </button>
            <button
              onClick={() => setGameState('START')}
              className="px-8 py-2 bg-black/40 text-white font-bold text-lg hover:bg-white/20 transition-colors uppercase skew-x-[-10deg] border border-white/20"
            >
              Tela Inicial
            </button>
          </div>
        </div>
      )}

      {gameState === 'COLOR_SELECTION' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md text-white p-8 text-center">
          <h1 className="text-6xl font-black uppercase tracking-tighter mb-4 italic">EVOLUÇÃO!</h1>
          <p className="text-xl mb-12 uppercase tracking-widest opacity-70">Você se tornou um PLANETA ANÃO. Escolha sua cor:</p>
          <div className="flex gap-6">
            {[
              { name: 'VERDE', hex: '#22c55e' },
              { name: 'CINZA', hex: '#9ca3af' },
              { name: 'AZUL', hex: '#3b82f6' },
              { name: 'PRETO', hex: '#111827' },
            ].map((color) => (
              <button
                key={color.hex}
                onClick={() => handleColorSelect(color.hex)}
                className="group flex flex-col items-center gap-4 transition-transform hover:scale-110"
              >
                <div 
                  className="w-24 h-24 rounded-full border-4 border-white/20 group-hover:border-white transition-colors shadow-2xl"
                  style={{ backgroundColor: color.hex }}
                />
                <span className="font-black text-sm tracking-widest">{color.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}


      {/* Mobile Controls */}
      {gameState === 'PLAYING' && !chatOpen && (
        <div className="absolute bottom-8 right-8 flex flex-col gap-2 md:hidden pointer-events-auto">
          <div className="flex justify-center">
            <button 
              onPointerDown={() => keysRef.current['ArrowUp'] = true}
              onPointerUp={() => keysRef.current['ArrowUp'] = false}
              onPointerLeave={() => keysRef.current['ArrowUp'] = false}
              className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center active:bg-white/40 border border-white/30"
            >
              <div className="w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[15px] border-b-white" />
            </button>
          </div>
          <div className="flex gap-2">
            <button 
              onPointerDown={() => keysRef.current['ArrowLeft'] = true}
              onPointerUp={() => keysRef.current['ArrowLeft'] = false}
              onPointerLeave={() => keysRef.current['ArrowLeft'] = false}
              className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center active:bg-white/40 border border-white/30"
            >
              <div className="w-0 h-0 border-t-[10px] border-t-transparent border-b-[10px] border-b-transparent border-r-[15px] border-r-white" />
            </button>
            <button 
              onPointerDown={() => keysRef.current['ArrowDown'] = true}
              onPointerUp={() => keysRef.current['ArrowDown'] = false}
              onPointerLeave={() => keysRef.current['ArrowDown'] = false}
              className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center active:bg-white/40 border border-white/30"
            >
              <div className="w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-t-[15px] border-t-white" />
            </button>
            <button 
              onPointerDown={() => keysRef.current['ArrowRight'] = true}
              onPointerUp={() => keysRef.current['ArrowRight'] = false}
              onPointerLeave={() => keysRef.current['ArrowRight'] = false}
              className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center active:bg-white/40 border border-white/30"
            >
              <div className="w-0 h-0 border-t-[10px] border-t-transparent border-b-[10px] border-b-transparent border-l-[15px] border-l-white" />
            </button>
          </div>
          <button 
            onClick={() => setChatOpen(true)}
            className="mt-2 w-full py-2 bg-white/10 backdrop-blur-md rounded-lg text-[10px] font-black uppercase tracking-widest border border-white/20"
          >
            Chat
          </button>
        </div>
      )}

      {/* Chat UI */}
      {gameState === 'PLAYING' && chatOpen && (
        <div className="absolute bottom-4 left-4 w-80 flex flex-col gap-2 pointer-events-none">
          {/* Message Log */}
          <div 
            ref={chatMessagesRef}
            className="flex flex-col gap-1 max-h-48 overflow-y-auto scrollbar-hide pointer-events-auto"
          >
            {chatMessages.map((msg, i) => (
              <div 
                key={i} 
                className={`bg-black/40 backdrop-blur-sm border border-white/10 rounded-lg px-3 py-1 text-xs text-white animate-in fade-in slide-in-from-left-2 duration-300 ${msg.sender === 'SISTEMA' ? 'border-yellow-500/30' : ''}`}
              >
                <span className={`font-black mr-2 uppercase ${msg.sender === 'SISTEMA' ? 'text-yellow-400' : 'text-cyan-400'}`}>
                  {msg.sender}:
                </span>
                <span className="opacity-90">{msg.text}</span>
              </div>
            ))}
          </div>

          {/* Input Field */}
          <div className="bg-black/60 backdrop-blur-md border border-white/20 rounded-2xl px-4 py-2 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-300 pointer-events-auto">
            <form onSubmit={sendChatMessage} className="flex items-center gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Digite sua mensagem..."
                className="w-full bg-transparent outline-none text-sm text-white placeholder:text-white/30 py-2"
                autoFocus
              />
              <button 
                type="button"
                onClick={() => setChatOpen(false)}
                className="text-[10px] opacity-50 hover:opacity-100 uppercase font-black"
              >
                X
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Game;
