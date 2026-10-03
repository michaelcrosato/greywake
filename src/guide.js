import { defaults } from './config.js';
import { newCareer, Simulation } from './simulation.js';
import { angleDelta, distance, PORTS } from './world.js';

const GUIDE_KEY = 'greywake.orientation.v1';
const $ = (id) => document.getElementById(id);
const countRanks = (values) => Object.values(values).reduce((sum, rank) => sum + rank, 0);

export const LESSONS = [
  {
    id: 'command',
    title: 'You have independent command',
    text: 'Your long-term goal is to build a stronger boat, captain, and crew by disrupting Allied shipping. A useful first patrol is: find a convoy, sink a merchant, evade its escorts, and resupply. You choose where and when. There are no assigned combat missions.',
    focus: '.patrol-status',
    reading: true,
  },
  {
    id: 'helm',
    title: 'Give the boat an engine and rudder order',
    text: 'Use W / S or the telegraph + / − buttons to set engine power. Hold A / D or a helm arrow to turn. Dragging the ocean changes the camera, not the course. Try 60% power and turn the boat at least a little.',
    focus: '.engine',
    tasks: [
      ['Set at least 60% engine power', (g) => g.sim.p.throttle >= 0.59],
      ['Change heading with the rudder', (g) => Math.abs(angleDelta(g.sim.p.heading, g.entryHeading)) > 0.1],
    ],
  },
  {
    id: 'dive',
    title: 'Dive to periscope depth: 12 metres',
    text: 'Press V or choose Scope 12 m in DEPTH CONTROL. The large number is your current depth; the order below it is the depth the crew is working toward. A dive takes time. At 12 m you can launch torpedoes while presenting a smaller target. Then use C / Camera for the optical periscope view.',
    focus: '.diving',
    tasks: [
      ['Order periscope depth', (g) => g.sim.p.targetDepth === 12],
      ['Reach 12 m', (g) => Math.abs(g.sim.p.depth - 12) < 0.5],
      ['Look through the periscope with C / Camera', (g) => g.app.view.mode === 'periscope'],
    ],
    maneuver: true,
  },
  {
    id: 'gauges',
    title: 'These four gauges keep you alive',
    text: 'HULL is boat integrity; zero means losing the boat. DIESEL powers surfaced travel. BATTERY powers submerged travel. O₂ is your air supply. Surfacing restores battery and oxygen; a harbor replenishes diesel, ammunition, and hull. Watch the gauges before starting a long submerged passage.',
    focus: '.resources',
    reading: true,
  },
  {
    id: 'contact',
    title: 'Find and select shipping',
    text: 'On the radar, white contacts are merchants; red contacts are escorts. Tap a ship label or use Next contact / Tab to select one. The contact card gives type, range, hull, and torpedo lead. Use Look toward contact / G to turn the view toward it. Hydrophones listen passively. An active sonar ping (Q) can alert nearby escorts.',
    focus: '.target-panel',
    tasks: [
      ['Select the practice merchant', (g) => !!g.sim.target() && !g.sim.target().escort],
      [
        'Look toward it with the contact button / G',
        (g) => {
          const t = g.sim.target();
          return (
            !!t &&
            Math.abs(
              angleDelta(g.sim.p.heading + g.app.view.orbit, Math.atan2(t.x - g.sim.p.x, g.sim.p.z - t.z)),
            ) < 0.18
          );
        },
      ],
    ],
  },
  {
    id: 'attack',
    title: 'Send a torpedo salvo',
    text: 'Use Launch torpedo or Space. The weapons officer calculates the lead automatically, but the torpedo then runs straight. A maneuvering ship can make it miss. Our practice merchant needs two hits with the standard weapon. Fire again when the room has reloaded and watch the contact hull bar.',
    focus: '#torpedo',
    tasks: [
      ['Launch a torpedo', (g) => g.sim.p.torpedoes < 14],
      ['Sink the practice merchant', (g) => g.sim.p.sunk >= 1],
    ],
    maneuver: true,
  },
  {
    id: 'evade',
    title: 'Break an escort’s search',
    text: 'An escort is now searching nearby. Order Dive 80 m (X), reduce power to 30% or less, and turn onto a new heading. Deep, quiet running reduces sonar detection; changing course helps avoid predicted depth-charge attacks. Practice damage is disabled, so experiment safely.',
    focus: '.diving',
    tasks: [
      ['Order and reach about 80 m', (g) => g.sim.p.targetDepth === 80 && g.sim.p.depth >= 75],
      ['Reduce engine power to 30% or less', (g) => g.sim.p.throttle <= 0.31],
      ['Change heading again', (g) => Math.abs(angleDelta(g.sim.p.heading, g.entryHeading)) > 0.25],
    ],
    maneuver: true,
  },
  {
    id: 'surface',
    title: 'Surface and try the deck gun',
    text: 'Press R or choose Surface to rise. Surfacing restores air and battery and enables the deck gun. The gun uses shells and has a shorter range than torpedoes. We have placed another merchant nearby: select it, then fire once with Deck gun / F.',
    focus: '.diving',
    tasks: [
      ['Surface the boat', (g) => g.sim.p.targetDepth === 0 && g.sim.p.depth < 1],
      ['Fire a deck-gun shell', (g) => g.sim.p.shells < g.entryShells],
    ],
    maneuver: true,
  },
  {
    id: 'skills',
    title: 'Spend a captain skill point',
    text: 'Sinking ships awards captain XP. Levels grant skill points. Open CAPTAIN (K) and train one first-row skill. Lower skills require the first rank above them. Navigation improves travel, Survival helps evasion and repair, and Combat improves weapon damage and reloads.',
    focus: '.side-nav [data-panel="captain"]',
    tasks: [['Train one captain skill', (g) => countRanks(g.sim.p.skills) > 0]],
  },
  {
    id: 'refit',
    title: 'Turn bounty into a better boat',
    text: 'Bounty is your spending money. Open REFIT and install one improvement. Refits are permanent career upgrades; the workshop can install them underway. Hull, engines, weapons, batteries, and hydrophones each solve a different problem.',
    focus: '.side-nav [data-panel="refit"]',
    tasks: [['Install a boat refit', (g) => countRanks(g.sim.p.upgrades) > 0]],
  },
  {
    id: 'crew',
    title: 'Give a department head a doctrine',
    text: 'All 44 hands earn crew experience at sea and in combat; ranks improve speed, weapon drills, and repairs. Your three department heads add distinct advantages. Open CREW and switch one doctrine. You can change doctrines freely to fit your next patrol.',
    focus: '.side-nav [data-panel="crew"]',
    tasks: [
      [
        'Change a department-head doctrine',
        (g) => Object.entries(g.sim.p.heads).some(([key, value]) => value !== g.entryHeads[key]),
      ],
    ],
  },
  {
    id: 'chart',
    title: 'Plot a passage to a harbor',
    text: 'You are now just offshore Horta in the Azores. Open CHART (M), choose Horta in the harbor list, and select Set course & engage autopilot. The navigator routes around land. Manual rudder input cancels autopilot, so let the navigator steer this passage.',
    focus: '.side-nav [data-panel="chart"]',
    tasks: [
      [
        'Set Horta as destination and engage autopilot',
        (g) => g.sim.p.auto && g.sim.p.destination?.name === 'Horta',
      ],
    ],
  },
  {
    id: 'time',
    title: 'Compress the empty passage',
    text: 'Click TIME COMPRESSION or press T to choose 5× or faster. Time acceleration is for uneventful travel: it returns to 1× near contacts or weapon action. Diesel and other resources still get used. Finish the short passage; the navigator stops engines on arrival.',
    focus: '.time',
    tasks: [
      ['Use time acceleration', (g) => g.didCompress],
      [
        'Arrive at Horta',
        (g) => !g.sim.p.auto && g.sim.p.route.length === 0 && distance(g.sim.p, PORTS[2]) < 200,
      ],
    ],
    maneuver: true,
  },
  {
    id: 'harbor',
    title: 'Resupply before the next patrol',
    text: 'For harbor service, surface within 8 km of a marked harbor. Open REFIT and use Resupply. The tender restores hull, diesel, battery, oxygen, torpedoes, and shells for bounty. Always keep a service reserve instead of spending every coin on upgrades.',
    focus: '.side-nav [data-panel="refit"]',
    tasks: [
      [
        'Pay for harbor service',
        (g) => g.sim.p.fuel === 100 && g.sim.p.torpedoes >= 14 && g.sim.p.hp === g.sim.maxHp(),
      ],
    ],
  },
  {
    id: 'ready',
    title: 'Your next decision is yours',
    text: 'You now know the patrol loop: choose waters → find shipping → attack → evade → grow the boat and crew → resupply. In a real patrol, check hull, fuel, battery, air, and ammunition first. Your original career is waiting exactly where you left it. Help / H keeps this orientation and the field manual within reach.',
    focus: '.patrol-status',
    reading: true,
  },
];

export function welcomeHTML(state, active = false) {
  return `<p class="panel-intro">You are an independent U-boat captain in 1942. Build your career by disrupting Allied merchant shipping, surviving escorts, and investing the bounty in your boat and crew. The ocean is open; you choose your own patrols.</p><div class="orientation-loop"><span>Find shipping</span><span>Attack & evade</span><span>Earn & improve</span><span>Resupply</span></div><div class="orientation-choice"><h3>A guided first patrol</h3><p>Learn the actual helm, diving, weapons, progression, and harbor controls in a protected practice boat. Your real career, resources, and encounters are kept safe. Read at your own pace; waiting maneuvers can be advanced.</p><button id="guide-start" class="primary">${active ? 'Return to guided practice' : state.step > 0 && !state.completed ? 'Resume orientation' : 'Start guided practice'}</button><button id="guide-start-over" class="secondary" ${state.step > 0 || active ? '' : 'hidden'}>Start practice from the beginning</button></div><div class="orientation-choice"><h3>Already know your boat?</h3><p>Enter the open sea now, or browse the field manual. Help / H lets you return to training at any time.</p><div class="file-actions"><button id="guide-skip">Continue my patrol</button><button data-panel="manual">Read the field manual</button></div></div>`;
}

export function manualHTML(sim, state = {}) {
  const c = sim.config;
  const topics = [
    [
      'Your objective',
      'Grow an independent captain, boat, and crew by disrupting Allied shipping. A good first patrol is one merchant sinking, a successful escape, and a harbor resupply. There are no assigned combat missions. Track ships sunk, tonnage, bounty, captain level, and crew ranks in the log.',
    ],
    [
      'Move and look',
      'W / S or the engine + / − buttons change power; A / D or helm arrows turn the boat. Dragging the sea rotates the camera and never turns the rudder. Wheel changes camera distance. C cycles chase, periscope, and tactical views.',
    ],
    [
      'Dive and surface',
      `R orders the surface; V orders periscope depth (12 m); X orders a deep dive (80 m). Depth control shows both current and ordered depth. A normal dive rate is ${c.navigation.diveRate} m/s. Torpedoes work at 18 m or less; the deck gun needs 2 m or less. Safe depth for this boat is ${sim.maxDepth()} m.`,
    ],
    [
      'What the gauges mean',
      'Hull is survival. Diesel powers surfaced sailing. Battery powers submerged sailing. Oxygen limits time under water. Surfacing restores air and recharges batteries; marked harbors restore diesel and ammunition. Critical battery or oxygen forces an emergency ascent. Undetected crews slowly repair hull damage underway.',
    ],
    [
      'Identify contacts',
      'Merchants offer tonnage and bounty; escorts search and fight. Tap a visible label or cycle nearby contacts with Tab / Next contact. Hydrophones listen passively. Active sonar (Q / PING) reports contacts but may give your position away.',
    ],
    [
      'Attack shipping',
      `Select a contact, stay within weapon range, and choose Launch torpedo / Space. Torpedoes have ${Math.round(c.combat.torpedoRange)} m base range and run straight after a calculated lead; ship maneuvers can defeat a shot. Watch hull integrity and reload status before firing another. The surfaced deck gun (F) has ${Math.round(c.combat.gunRange)} m range and consumes shells. Ships sunk award bounty, captain XP, and crew XP.`,
    ],
    [
      'Escape an escort',
      'Surface visibility and underwater engine noise affect detection. Dive, reduce engine power, and change course. Deep running helps sonar evasion, but consumes air and battery. Depth charges predict your position and depth; change both. Going faster is sometimes needed to open distance, at the cost of a louder signature.',
    ],
    [
      'Navigate the world',
      'Open CHART / M, pick open water or a harbor, then engage autopilot. Rudder input cancels it. Choose nearby corridors shown by dashed shipping lanes to find traffic. Use T / TIME COMPRESSION while nothing needs your attention; encounters automatically slow time. A route is a navigation order, not a combat mission.',
    ],
    [
      'Harbors and recovery',
      'Surface within 8 km of a marked harbor. REFIT → Resupply pays for a complete hull/resource/ammunition restoration. Harbor services and upgrades both spend bounty. If hull reaches zero, salvage restores the boat at the nearest harbor for 25% of bounty while keeping skills, ranks, and refits.',
    ],
    [
      'Three ways to improve',
      'Captain XP produces skill points for a prerequisite skill tree. Bounty buys permanent boat refits. Crew XP improves ranks automatically; department-head doctrines in CREW add freely switchable bonuses. Check the descriptions and next-level costs before committing.',
    ],
    [
      'Save, pause, and tune',
      'P or the Pause button pauses. Panels pause the patrol except live settings. Career autosaves and portable exports are available in the log. The gear menu changes graphics, physics, traffic, weapons, and economy; developer actions change the current career. Practice rewards and spending do not affect your real patrol.',
    ],
  ];
  return `<p class="panel-intro">A captain’s quick reference. Return here with Help / H whenever a system is unclear.</p><div class="file-actions manual-actions"><button id="manual-practice" class="primary">${sim.training ? 'Continue orientation' : state.step > 0 && !state.completed ? 'Resume guided orientation' : 'Replay guided orientation'}</button></div><div class="manual-topics">${topics.map(([title, text], i) => `<details ${i === 0 ? 'open' : ''}><summary>${String(i + 1).padStart(2, '0')} / ${title}</summary><p>${text}</p></details>`).join('')}</div><div class="help-grid manual-controls"><span><kbd>W / S</kbd>Engine power</span><span><kbd>A / D</kbd>Rudder</span><span><kbd>R / V / X</kbd>Surface / 12 m / 80 m</span><span><kbd>SPACE / F</kbd>Torpedo / deck gun</span><span><kbd>TAB / Q</kbd>Next contact / active ping</span><span><kbd>C / M</kbd>Camera / world chart</span><span><kbd>T / P</kbd>Time compression / pause</span><span><kbd>H</kbd>Field manual & training</span></div>`;
}

export class Orientation {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.careerSim = null;
    this.state = { version: 1, completed: false, dismissed: false, step: 0 };
    try {
      const raw = JSON.parse(localStorage.getItem(GUIDE_KEY) || 'null');
      if (raw?.version === 1)
        this.state = {
          ...this.state,
          completed: !!raw.completed,
          dismissed: !!raw.dismissed,
          step: Math.floor(Math.max(0, Math.min(LESSONS.length - 1, Number(raw.step) || 0))),
        };
    } catch {}
    this.elapsed = 0;
    this.lastPanel = null;
    this.cache = '';
    $('guide-next').onclick = () => this.next();
    $('guide-exit').onclick = () => this.stop(false);
    $('guide-wait').onclick = () => this.advanceManeuver();
    window.addEventListener('resize', () => this.highlight());
    document.addEventListener(
      'scroll',
      () => {
        if (this.active) this.highlight();
      },
      true,
    );
  }
  get sim() {
    return this.app.sim;
  }
  get lesson() {
    return LESSONS[this.state.step];
  }
  get shouldOffer() {
    return !this.state.completed && !this.state.dismissed;
  }
  save() {
    try {
      localStorage.setItem(GUIDE_KEY, JSON.stringify(this.state));
    } catch {}
  }
  bindWelcome() {
    $('guide-start').onclick = () => (this.active ? this.app.ui.close() : this.start(false));
    $('guide-start-over').onclick = () => this.start(true);
    $('guide-skip').onclick = () => {
      if (this.active) this.stop(false);
      this.state.dismissed = true;
      this.save();
      this.app.begin({ guided: false });
    };
  }
  start(restart = false) {
    this.app.ui.close();
    if (!this.app.started) this.app.begin({ guided: false });
    if (!this.active) {
      this.app.save();
      this.careerSim = this.sim;
      this.careerPaused = this.sim.paused;
      this.careerSim.paused = true;
      this.careerCamera = {
        mode: this.app.view.mode,
        orbit: this.app.view.orbit,
        elevation: this.app.view.elevation,
      };
      const config = defaults();
      config.ocean.dayCycle = false;
      Object.assign(config.graphics, this.careerSim.config.graphics);
      const p = newCareer();
      p.speed = 0;
      p.throttle = 0.2;
      const practice = new Simulation(config, p, { training: true });
      this.app.attachSimulation(practice);
      this.active = true;
      this.app.view.mode = 'chase';
      this.app.view.orbit = -0.45;
      this.app.view.elevation = 0;
    } else if (restart) {
      const old = this.sim;
      const p = newCareer();
      p.speed = 0;
      p.throttle = 0.2;
      this.app.attachSimulation(new Simulation(this.sim.config, p, { training: true }));
      old.dispose();
    }
    this.app.ui.syncCamera();
    $('toast').hidden = true;
    clearTimeout(this.app.ui.toastTimer);
    if (restart || this.state.completed) this.state.step = 0;
    this.state.completed = false;
    this.state.dismissed = false;
    document.body.classList.add('tutorial-active');
    $('guide').hidden = false;
    this.enter();
    this.save();
  }
  clearTraffic() {
    for (const s of this.sim.ships) this.sim.physics.removeRigidBody(s.body);
    for (const t of this.sim.torpedoes) this.sim.physics.removeRigidBody(t.body);
    this.sim.ships = [];
    this.sim.torpedoes = [];
    this.sim.charges = [];
    this.sim.effects = [];
    this.sim.targetId = null;
    this.sim.detected = false;
  }
  placeBoat(x, z, depth = 0) {
    const p = this.sim.p;
    Object.assign(p, {
      x,
      z,
      depth,
      targetDepth: depth,
      heading: 0,
      speed: 0,
      auto: false,
      route: [],
      destination: null,
    });
    this.sim.origin = { x, z };
    this.sim.oceanX = x;
    this.sim.body.setTranslation({ x: 0, y: -2 - depth, z: 0 }, true);
    this.sim.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }
  merchant() {
    const p = this.sim.p;
    const s = this.sim.addShip(p.x + 300, p.z - 400, 1.2, false, 1942);
    if (s) s.name = 'SS Meridian · practice';
    return s;
  }
  enter() {
    if (this.app.ui.panel) this.app.ui.close();
    const lesson = this.lesson,
      p = this.sim.p;
    this.sim.paused = !!lesson.reading;
    this.sim.rudder = 0;
    this.sim.acceleration = 1;
    this.app.clearInputs?.();
    this.entryHeading = p.heading;
    this.entryHeads = { ...p.heads };
    this.entryShells = p.shells;
    this.didCompress = false;
    this.lastPanel = null;
    this.cache = '';
    if (
      ['command', 'helm', 'dive', 'gauges', 'contact', 'attack'].includes(lesson.id) &&
      !this.sim.ships.some((s) => s.hp > 0 && !s.escort)
    ) {
      this.clearTraffic();
      this.merchant();
    }
    if (lesson.id === 'helm') {
      p.throttle = 0.2;
    }
    if (['dive', 'gauges', 'contact', 'attack'].includes(lesson.id) && this.state.step > 2) {
      p.targetDepth = 12;
      this.placeBoat(p.x, p.z, 12);
      p.throttle = 0.4;
    }
    if (lesson.id === 'contact') this.sim.targetId = null;
    if (lesson.id === 'attack') {
      if (!this.sim.target())
        this.sim.targetId = this.sim.ships.find((s) => s.hp > 0 && !s.escort)?.id ?? null;
      p.torpedoes = 14;
      p.sunk = 0;
    }
    if (lesson.id === 'evade') {
      this.clearTraffic();
      this.sim.addShip(p.x + 750, p.z - 500, Math.PI, true, 90);
    }
    if (lesson.id === 'surface') {
      this.clearTraffic();
      const s = this.merchant();
      if (s) this.sim.targetId = s.id;
      p.shells = 80;
      this.entryShells = 80;
    }
    if (lesson.id === 'skills') {
      p.skillPoints = Math.max(1, p.skillPoints);
      p.skills = Object.fromEntries(Object.keys(p.skills).map((k) => [k, 0]));
    }
    if (lesson.id === 'refit') {
      p.bounty = Math.max(2000, p.bounty);
      p.upgrades = Object.fromEntries(Object.keys(p.upgrades).map((k) => [k, 0]));
    }
    if (lesson.id === 'chart') {
      this.clearTraffic();
      this.placeBoat(PORTS[2].x - 1000, PORTS[2].z + 1200);
      p.throttle = 0.5;
    }
    if (lesson.id === 'time' && !p.destination) {
      this.clearTraffic();
      this.placeBoat(PORTS[2].x - 1000, PORTS[2].z + 1200);
      this.sim.setDestination(PORTS[2], 'Horta');
    }
    if (lesson.id === 'harbor') {
      this.clearTraffic();
      this.placeBoat(PORTS[2].x, PORTS[2].z);
      Object.assign(p, {
        hp: this.sim.maxHp() - 30,
        fuel: 75,
        torpedoes: 8,
        shells: 50,
        bounty: Math.max(2000, p.bounty),
        throttle: 0,
      });
    }
    $('guide-heading').textContent = lesson.title;
    $('guide-report').textContent = '';
    $('guide-copy').textContent = lesson.text;
    $('guide-count').textContent = `${this.state.step + 1} / ${LESSONS.length}`;
    $('guide-next').textContent =
      this.state.step === LESSONS.length - 1 ? 'Return to my patrol' : 'Next lesson';
    $('guide-progress').style.width = `${((this.state.step + 1) / LESSONS.length) * 100}%`;
    this.tick(1);
    this.highlight();
    $('sea').focus();
    this.save();
  }
  ready() {
    return this.lesson.reading || (this.lesson.tasks || []).every(([, check]) => check(this));
  }
  next() {
    if (!this.active || !this.ready()) return;
    if (this.state.step === LESSONS.length - 1) {
      this.stop(true);
      return;
    }
    this.state.step++;
    this.enter();
  }
  stop(completed = false) {
    if (!this.active) return;
    this.app.ui.close();
    const practice = this.sim;
    const career = this.careerSim;
    this.active = false;
    this.careerSim = null;
    this.app.attachSimulation(career);
    practice.dispose();
    Object.assign(this.app.view, this.careerCamera);
    career.paused = this.careerPaused;
    this.app.ui.syncCamera();
    document.body.classList.remove('tutorial-active', 'tutorial-modal');
    $('guide').hidden = true;
    $('guide-highlight').hidden = true;
    if (completed) {
      this.state.completed = true;
      this.state.step = 0;
    }
    this.state.dismissed = true;
    this.save();
    this.app.save();
    this.app.ui.toast(
      completed
        ? 'Orientation complete. Your original patrol is ready; Help / H keeps the field manual nearby.'
        : 'Practice paused. Your original patrol is restored; Help / H can resume orientation.',
    );
    $('sea').focus();
  }
  advanceManeuver() {
    if (!this.active || this.sim.paused) return;
    const id = this.lesson.id,
      p = this.sim.p;
    let seconds = 0;
    if (['dive', 'evade', 'surface'].includes(id))
      seconds = Math.abs(p.depth - p.targetDepth) / this.sim.config.navigation.diveRate + 2;
    if (id === 'attack' && this.sim.torpedoes.length)
      seconds = Math.min(90, Math.max(...this.sim.torpedoes.map((t) => t.life)));
    if (id === 'time' && p.auto && this.sim.acceleration > 1) {
      this.didCompress = true;
      seconds = Math.min(
        600,
        distance(p, p.destination) / Math.max(2, this.sim.speedLimit() * p.throttle) + 30,
      );
    }
    const factor = this.sim.acceleration;
    for (let i = 0; i < Math.ceil((seconds * 30) / factor); i++) this.sim.update(1 / 30);
    this.tick(1);
  }
  tick(dt) {
    if (!this.active) return;
    this.elapsed += dt;
    if (this.elapsed < 0.1) return;
    this.elapsed = 0;
    if (this.lesson.id === 'time' && this.sim.acceleration > 1) this.didCompress = true;
    const tasks = this.lesson.tasks || [],
      values = tasks.map(([, check]) => !!check(this)),
      ready = this.ready();
    const key = JSON.stringify([
      values,
      ready,
      this.app.ui.panel,
      this.sim.torpedoes.length,
      this.sim.p.targetDepth,
      this.sim.p.depth < 1,
    ]);
    if (key !== this.cache) {
      this.cache = key;
      $('guide-tasks').innerHTML = tasks
        .map(
          ([label], i) =>
            `<li class="${values[i] ? 'complete' : ''}"><span aria-hidden="true">${values[i] ? '✓' : '○'}</span>${label}</li>`,
        )
        .join('');
      $('guide-next').disabled = !ready;
      $('guide-wait').hidden = !this.lesson.maneuver || ready || !!this.app.ui.panel;
      $('guide-wait').textContent =
        this.lesson.id === 'attack'
          ? 'Advance torpedo run'
          : this.lesson.id === 'time'
            ? 'Advance short passage'
            : 'Advance ordered maneuver';
      $('guide-wait').disabled =
        this.lesson.id === 'attack'
          ? this.sim.torpedoes.length === 0
          : this.lesson.id === 'time'
            ? this.sim.acceleration <= 1 || !this.sim.p.auto
            : this.sim.p.depth === this.sim.p.targetDepth;
      document.body.classList.toggle('tutorial-modal', !!this.app.ui.panel);
      $('guide').classList.toggle('modal-guide', !!this.app.ui.panel);
      this.highlight();
    }
  }
  highlight() {
    if (!this.active) return;
    const element = document.querySelector(this.app.ui.panel ? '#modal .modal-header' : this.lesson.focus);
    const candidateBox = element?.getBoundingClientRect();
    const box = candidateBox?.width && candidateBox?.height ? candidateBox : null;
    $('guide-highlight').hidden = !box;
    if (box) {
      Object.assign($('guide-highlight').style, {
        left: `${Math.max(2, box.left - 5)}px`,
        top: `${Math.max(2, box.top - 5)}px`,
        width: `${Math.min(innerWidth - 4, box.width + 10)}px`,
        height: `${box.height + 10}px`,
      });
    }
    const card = $('guide');
    if (this.app.ui.panel) {
      card.style.removeProperty('left');
      card.style.removeProperty('top');
      card.style.removeProperty('right');
      card.style.removeProperty('bottom');
      return;
    }
    const size = card.getBoundingClientRect(),
      bottom = innerHeight < 550 ? 132 : 282;
    const candidates = [
      { left: innerWidth - size.width - 16, top: innerHeight - bottom - size.height },
      { left: 16, top: innerHeight - bottom - size.height },
      { left: innerWidth - size.width - 16, top: innerHeight < 550 ? 74 : 108 },
      { left: 16, top: innerHeight < 550 ? 74 : 108 },
    ];
    const overlap = (p) =>
      box
        ? Math.max(0, Math.min(p.left + size.width, box.right) - Math.max(p.left, box.left)) *
          Math.max(0, Math.min(p.top + size.height, box.bottom) - Math.max(p.top, box.top))
        : 0;
    candidates.sort((a, b) => overlap(a) - overlap(b));
    const position = candidates[0];
    card.style.setProperty('--guide-left', `${Math.max(12, position.left)}px`);
    card.style.setProperty('--guide-top', `${Math.max(72, position.top)}px`);
    card.style.setProperty('--guide-height', `${size.height}px`);
    for (const property of ['left', 'right', 'top', 'bottom']) card.style.removeProperty(property);
  }
}
