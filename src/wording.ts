// Keep older saved AI feedback consistent with the current interface voice.
// Original announcements, extracted values and suggested text stay verbatim.
const commands: Record<string, string> = {
  doplňte: 'doplň',
  upresnite: 'upresni',
  skráťte: 'skráť',
  uveďte: 'uveď',
  napíšte: 'napíš',
  zadajte: 'zadaj',
  skontrolujte: 'skontroluj',
  opravte: 'oprav',
  overte: 'over',
  skúste: 'skús',
  pridajte: 'pridaj',
  špecifikujte: 'špecifikuj',
};
export function informalFeedback(text: string): string {
  return text.replace(/\p{L}+/gu, (word) => {
    const replacement = commands[word.toLocaleLowerCase('sk')];
    if (!replacement) return word;
    return word[0] === word[0].toLocaleUpperCase('sk')
      ? replacement[0].toLocaleUpperCase('sk') + replacement.slice(1)
      : replacement;
  });
}
