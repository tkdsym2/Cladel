/**
 * True while an IME (e.g. Japanese kana→kanji conversion) is composing.
 *
 * The Enter / Space / arrow keys pressed to pick or confirm a conversion must
 * not be treated as "submit" / "select" by our own key handlers. `isComposing`
 * covers most engines; WebKit (the macOS WebView) reports the confirming Enter
 * with `isComposing === false`, but still with the legacy keyCode 229.
 */
export function isImeComposing(
  e: KeyboardEvent | { nativeEvent: KeyboardEvent },
): boolean {
  const ev = "nativeEvent" in e ? e.nativeEvent : e;
  return ev.isComposing || ev.keyCode === 229;
}
