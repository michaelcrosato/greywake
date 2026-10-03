export function captainIntent(sim) {
  const p = sim.p,
    target = sim.target();
  if (p.hp <= 0)
    return {
      key: 'lost',
      title: 'Recover your boat',
      text: 'Salvage keeps your captain, crew ranks, and refits.',
      action: 'manual',
      label: 'Review recovery',
    };
  if (sim.paused)
    return {
      key: 'paused',
      title: 'Patrol paused',
      text: 'Time is stopped. Plan your next order, then resume the boat.',
      action: 'resume',
      label: 'Resume patrol · P',
    };
  if (p.depth > 3 && (p.oxygen < 20 || p.battery < 15))
    return {
      key: 'air',
      title: 'Surface for air and power',
      text: 'Air or battery is low. Surface to replenish both.',
      action: 'surface',
      label: 'Order surface · R',
    };
  if (sim.detected) {
    if (p.depth < 75)
      return {
        key: 'escape',
        title: 'Dive and evade the escort',
        text: 'Order 80 m, slow down, and change your heading.',
        action: 'deep',
        label: 'Order 80 m · X',
      };
    if (p.throttle > 0.35)
      return {
        key: 'quiet',
        title: 'Reduce your sonar signature',
        text: 'Quiet running is harder to hear. Turn to avoid predicted attacks.',
        action: 'quiet',
        label: 'Set 25% power',
      };
    return {
      key: 'evade',
      title: 'Keep changing the attack solution',
      text: 'Change course and depth until the escort loses your signature.',
      action: 'manual',
      label: 'Review evasion',
    };
  }
  if (p.hp < sim.maxHp() * 0.5 || p.fuel < 25 || p.torpedoes <= 1)
    return {
      key: 'resupply',
      title: 'Plan a harbor stop',
      text: 'Keep a service reserve. Surface near a harbor and resupply in REFIT.',
      action: 'harbor',
      label: 'Choose nearest harbor',
    };
  if (p.auto && p.destination)
    return {
      key: 'passage',
      title: `Passage to ${p.destination.name}`,
      text: sim.inCombat()
        ? 'Contacts nearby: time remains at 1×. Steer manually to cancel autopilot.'
        : 'Let the navigator steer. Compress time during this empty passage.',
      action: sim.inCombat() ? 'focus' : 'time',
      label: sim.inCombat() ? 'Inspect selected contact' : 'Compress time · T',
    };
  if (target) {
    if (target.escort)
      return {
        key: 'escort',
        title: 'Choose your engagement',
        text: 'Escorts can defend the convoy. Merchants are the safer first targets.',
        action: 'contact',
        label: 'Cycle contacts · Tab',
      };
    if (sim.torpedoes.length)
      return {
        key: 'salvo',
        title: 'Watch your salvo',
        text: 'Hits reduce hull integrity. Fire again after reload if the ship survives.',
        action: 'focus',
        label: 'Look toward contact',
      };
    const readiness = sim.weaponReadiness('torpedo');
    if (p.depth > 18 || p.depth < 3)
      return {
        key: 'approach',
        title: 'Prepare a submerged attack',
        text: 'Periscope depth is 12 m. Torpedoes can launch at 18 m or less.',
        action: 'scope',
        label: 'Order 12 m · V',
      };
    if (!readiness.ready)
      return {
        key: 'weapon',
        title: readiness.reason,
        text: 'Check range, ammunition, and reload status on the weapon controls.',
        action: 'focus',
        label: 'Look toward contact',
      };
    return {
      key: 'attack',
      title: 'Merchant within reach',
      text: 'Launch a salvo, watch hull integrity, then prepare to evade.',
      action: 'torpedo',
      label: 'Launch torpedo · Space',
    };
  }
  return {
    key: 'patrol',
    title: p.sunk ? 'Choose your next patrol' : 'Your first patrol',
    text: 'Find shipping, sink a merchant, break contact, and resupply. You choose the waters.',
    action: 'chart',
    label: 'Open world chart · M',
  };
}
