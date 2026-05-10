/**
 * Abstraction over device haptic feedback.
 *
 * Currently a no-op on every platform. iOS Safari does not implement
 * `navigator.vibrate`, and Android web haptics are inconsistent enough that we
 * prefer to wait until we ship a PWA / native wrapper (Capacitor, Tauri, etc.)
 * before wiring real vibrations. Keep call sites in place so flipping the
 * implementation later is a one-file change.
 */
export const haptic = {
  /** Subtle tap, e.g. tab switch or chip select. */
  selection: () => {},
  /** Light pulse, e.g. value tick / day-picker move. */
  light: () => {},
  /** Medium pulse, e.g. error toast. */
  medium: () => {},
  /** Success burst, e.g. transaction saved. */
  success: () => {},
};
