// Platform/game independent startup contract. No DOM, renderer or game imports.
export const BOOT_STAGES = Object.freeze([
  ['SYS', 'Platform capabilities', 8, 5000],
  ['WASM', 'WebAssembly', 16, 8000],
  ['GPU', 'Graphics capabilities', 28, 20000],
  ['LOAD', 'Game resources', 40, 30000],
  ['PHY', 'Physics', 52, 30000],
  ['WORLD', 'World and scene', 62, 30000],
  ['RENDER', 'Rendering device', 72, 30000],
  ['SKY', 'Lighting and reflections', 82, 30000],
  ['SHDR', 'Shader compilation', 92, 60000],
  ['FRAME', 'First rendered frame', 98, 60000],
  ['UI', 'Controls and interface', 99, 10000],
]);

export class BootError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BootError';
    this.code = code;
  }
}

export class BootLoader {
  constructor({ name, version, buildId, onChange = () => {}, now = () => Date.now() }) {
    this.onChange = onChange;
    this.now = now;
    this.cursor = 0;
    this.busy = false;
    this.report = {
      schema: 'game-boot/1',
      game: name,
      version,
      buildId,
      status: 'starting',
      stage: 'SCRIPT',
      percent: 0,
      startedAt: new Date(now()).toISOString(),
      platform: {},
      capabilities: {},
      renderer: 'Not selected',
      adapter: { description: 'Not available yet' },
      stages: [],
      errors: [],
    };
    this.emit();
  }
  snapshot() {
    return JSON.parse(JSON.stringify(this.report));
  }
  emit() {
    this.onChange(this.snapshot());
  }
  assertActive() {
    if (this.report.status === 'failed') throw new BootError('BOOT-STOPPED', 'Startup has already stopped.');
  }
  update(values) {
    this.assertActive();
    Object.assign(this.report, values);
    if (values.adapter)
      this.report.adapter.description =
        values.adapter.description ||
        values.adapter.architecture ||
        values.adapter.vendor ||
        'Not disclosed by browser';
    this.emit();
  }
  note(code, error) {
    this.assertActive();
    this.record(code, error, false);
    this.emit();
  }
  record(code, error, fatal) {
    this.report.errors.push({
      stage: this.report.stage,
      code,
      fatal,
      message: String(error?.message || error).slice(0, 2000),
      stack: String(error?.stack || '').slice(0, 12000),
    });
  }
  fail(code, error) {
    if (this.report.status === 'failed') {
      if (code === 'BOOT-STOPPED') return;
      const message = String(error?.message || error).slice(0, 2000);
      if (
        this.report.errors.length < 50 &&
        !this.report.errors.some((entry) => entry.code === code && entry.message === message)
      ) {
        this.record(code, error, true);
        this.emit();
      }
      return;
    }
    if (this.report.status === 'ready') this.report.stage = 'RUN';
    this.record(code, error, true);
    this.report.status = 'failed';
    this.report.failureCode = code;
    const current = this.report.stages[this.report.stages.length - 1];
    if (current && current.status === 'working') current.status = 'failed';
    this.emit();
  }
  async stage(code, operation, timeoutMs) {
    this.assertActive();
    const spec = BOOT_STAGES[this.cursor];
    if (this.busy || !spec || spec[0] !== code) {
      const error = new BootError('BOOT-ORDER', `Expected ${spec?.[0] || 'READY'}, received ${code}.`);
      this.fail(error.code, error);
      throw error;
    }
    this.busy = true;
    this.report.stage = code;
    this.report.status = 'starting';
    const entry = { code, label: spec[1], percent: spec[2], status: 'working', elapsedMs: 0 };
    this.report.stages.push(entry);
    this.emit();
    const start = this.now();
    let timer;
    try {
      // Rendering the boot panel gets a browser task before synchronous work starts.
      await new Promise((resolve) => setTimeout(resolve, 0));
      this.assertActive();
      const value = await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new BootError(`${code}-TIME`, `${spec[1]} did not finish within ${timeoutMs ?? spec[3]} ms.`),
              ),
            timeoutMs ?? spec[3],
          );
        }),
      ]);
      this.assertActive();
      entry.elapsedMs = this.now() - start;
      entry.status = 'ok';
      this.report.percent = spec[2];
      this.cursor++;
      this.emit();
      return value;
    } catch (error) {
      entry.elapsedMs = this.now() - start;
      this.fail(error.code || `${code}-FAIL`, error);
      throw error;
    } finally {
      clearTimeout(timer);
      this.busy = false;
    }
  }
  complete() {
    this.assertActive();
    if (this.busy || this.cursor !== BOOT_STAGES.length) {
      const error = new BootError('BOOT-INCOMPLETE', 'Required startup stages have not all passed.');
      this.fail(error.code, error);
      throw error;
    }
    this.report.status = 'ready';
    this.report.stage = 'READY';
    this.report.percent = 100;
    this.emit();
  }
}
