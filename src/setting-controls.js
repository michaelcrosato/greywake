// Legacy tuples remain the source of defaults. Optional metadata describes newer types.
export const escapeSetting = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

export function settingType(spec) {
  return spec[6]?.type || (typeof spec[1] === 'boolean' ? 'boolean' : spec[5] ? 'enum' : 'number');
}

export function validateSetting(spec, value, { strict = false } = {}) {
  const type = settingType(spec);
  let valid;
  if (type === 'boolean') valid = typeof value === 'boolean';
  else if (type === 'color') valid = typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
  else if (type === 'enum') valid = spec[5].includes(value);
  else
    valid =
      Number.isFinite(value) &&
      value >= spec[2] &&
      value <= spec[3] &&
      (type !== 'integer' || Number.isInteger(value));
  if (valid) return type === 'color' ? value.toLowerCase() : value;
  if (strict) throw new Error(`Invalid ${spec[0]}.`);
  if (Number.isFinite(value) && typeof spec[1] === 'number') {
    if (spec[5])
      return spec[5].reduce((best, option) =>
        Math.abs(option - value) < Math.abs(best - value) ? option : best,
      );
    const bounded = Math.min(spec[3], Math.max(spec[2], value));
    return type === 'integer' ? Math.round(bounded) : bounded;
  }
  return spec[1];
}

export function settingValue(input, spec) {
  const type = settingType(spec);
  return validateSetting(
    spec,
    type === 'boolean'
      ? input.checked
      : typeof spec[1] === 'number'
        ? input.value.trim()
          ? Number(input.value)
          : NaN
        : input.value,
    { strict: true },
  );
}

export function settingText(value) {
  return typeof value === 'boolean'
    ? value
      ? 'ON'
      : 'OFF'
    : typeof value === 'number'
      ? Number(value.toFixed(3)).toString()
      : value;
}

export function settingControl(path, spec, value, attribute, { numeric = false } = {}) {
  const type = settingType(spec),
    key = escapeSetting(path),
    label = escapeSetting(spec[0]),
    v = escapeSetting(value);
  const attr = `${attribute}="${key}" aria-label="${label}"`;
  if (type === 'enum')
    return `<select ${attr}>${spec[5].map((option) => `<option value="${escapeSetting(option)}" ${option === value ? 'selected' : ''}>${escapeSetting(spec[6]?.choices?.[option] || option)}</option>`).join('')}</select>`;
  if (type === 'boolean') return `<input ${attr} type="checkbox" ${value ? 'checked' : ''} />`;
  if (type === 'color') return `<input ${attr} type="color" value="${v}" />`;
  const range = `min="${spec[2]}" max="${spec[3]}" step="${type === 'integer' ? 1 : spec[4]}" value="${v}"`;
  return `<input ${attr} type="range" ${range} />${numeric ? `<input ${attribute}="${key}" aria-label="${label} exact value" type="number" min="${spec[2]}" max="${spec[3]}" step="${type === 'integer' ? 1 : 'any'}" value="${v}" />` : ''}`;
}
