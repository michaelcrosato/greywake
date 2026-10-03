export class Sound {
  start() {
    if (this.context) {
      this.context.resume();
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.context.destination);
    const buffer = this.context.createBuffer(1, this.context.sampleRate * 3, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < data.length; i++) {
      brown = (brown + Math.random() * 0.04 - 0.02) / 1.02;
      data[i] = brown * 5;
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    this.filter = this.context.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 450;
    this.ambience = this.context.createGain();
    this.ambience.gain.value = 0.3;
    source.connect(this.filter);
    this.filter.connect(this.ambience);
    this.ambience.connect(this.master);
    source.start();
    this.engine = this.context.createOscillator();
    this.engine.type = 'sawtooth';
    this.engine.frequency.value = 38;
    this.engineGain = this.context.createGain();
    this.engineGain.gain.value = 0.02;
    this.engine.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engine.start();
  }
  update(sim) {
    if (!this.context) return;
    this.master.gain.setTargetAtTime(sim.config.graphics.sound, this.context.currentTime, 0.2);
    this.engine.frequency.setTargetAtTime(27 + sim.p.speed * 3, this.context.currentTime, 0.3);
    this.filter.frequency.setTargetAtTime(sim.p.depth > 4 ? 140 : 550, this.context.currentTime, 0.4);
    this.engineGain.gain.setTargetAtTime(
      sim.paused ? 0 : 0.004 + sim.p.throttle * 0.015,
      this.context.currentTime,
      0.3,
    );
  }
  play(type) {
    if (!this.context) return;
    const ctx = this.context,
      osc = ctx.createOscillator(),
      gain = ctx.createGain(),
      now = ctx.currentTime;
    osc.connect(gain);
    gain.connect(this.master);
    const ping = type === 'ping',
      explosion = type === 'explosion' || type === 'gun' || type === 'hurt';
    osc.type = ping ? 'sine' : explosion ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(ping ? 1100 : explosion ? 90 : 260, now);
    osc.frequency.exponentialRampToValueAtTime(ping ? 700 : 25, now + 0.6);
    gain.gain.setValueAtTime(ping ? 0.12 : 0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (ping ? 1.4 : 0.7));
    osc.start();
    osc.stop(now + 1.5);
  }
}
