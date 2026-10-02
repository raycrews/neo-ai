// Shared by all windows. Paper/ink variables are deliberately left to View → Page.
(() => {
  const root = document.documentElement;
  let received = false;
  function apply(value) {
    if (!value) return;
    const light = value.resolvedTheme === 'light';
    root.dataset.appTheme = light ? 'light' : 'dark';
    const base = value.accent;
    const rgb = [1, 3, 5].map(offset => parseInt(base.slice(offset, offset + 2), 16));
    const luminance = values => values.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    // Adjust accent text for contrast while retaining the chosen hue.
    let readable = [...rgb];
    const background = light ? .9 : .025;
    for (let i = 0; i < 100; i++) {
      const lum = luminance(readable);
      if ((Math.max(lum, background) + .05) / (Math.min(lum, background) + .05) >= 4.5) break;
      readable = readable.map(v => light ? v * .94 : v + (255 - v) * .06);
    }
    const textAccent = '#' + readable.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
    root.style.setProperty('--accent', textAccent);
    root.style.setProperty('--ui-accent-fill', base);
    root.style.setProperty('--ui-accent-ink', luminance(rgb) > .179 ? '#171717' : '#ffffff');
    root.style.setProperty('--ui-accent-soft', `rgba(${rgb.join(',')},${light ? '.17' : '.16'})`);
    root.style.setProperty('--ai-gold', textAccent);
    window.dispatchEvent(new CustomEvent('neo-appearance', { detail: value }));
    window.neoAppearanceState = value;
  }
  window.neoAppearance?.onChange(value => { received = true; apply(value); });
  window.neoAppearance?.read().then(value => { if (!received) apply(value); });
})();
