const recentCount = 4;
const followUp = /^(?:а\s|и\s|почему\s*[?.!]*$|(?:можно\s+)?(?:(?:приведи(?:те)?|покажи(?:те)?|дай(?:те)?)\s+)?пример(?=[\s.!?]|$)|(?:по)?подробнее|(?:а\s+)?(?:первый|второй|третий|последний)\s*[?.!]*$|(?:можешь|можете)\s+(?:пояснить|уточнить)|в ч[её]м разница\s*[?.!]*$|что (?:это|именно) значит|what about|and\s|(?:give|show)(?: me)? an example|why\s*[?.!]*$)/iu;

export function isDialogueFollowUp(question) {
  return followUp.test(question.trim());
}

export function rememberDialogueTurn(turns, question, answer) {
  const turn = { question: question.slice(0, 3000), answer: answer.slice(0, 4500) };
  const previous = turns.at(-1);
  turn.topic = previous && isDialogueFollowUp(question)
    ? previous.topic : { question: turn.question, answer: turn.answer };
  turns.push(turn);
  if (turns.length > 40) turns.shift();
}

export function selectDialogue(turns, question) {
  const terms = text => new Set((text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])
    .filter(word => !/^(?:что|как|какие|какой|когда|можно|расскажи|объясни|почему|подробнее|пример|ответь|вернёмся|вернемся|question|please|about|explain)$/u.test(word)));
  const query = terms(question);
  const recent = turns.slice(-recentCount);
  const earlier = turns.slice(0, -recentCount);
  const anchor = isDialogueFollowUp(question)
    ? turns.at(-1)?.topic || earlier.findLast(turn => !isDialogueFollowUp(turn.question))
    : undefined;
  const sameExchange = (turn, other) => turn.question === other.question && turn.answer === other.answer;
  const needsAnchor = anchor && !recent.some(turn => sameExchange(turn, anchor));
  const related = earlier.map((turn, index) => ({
    turn, index, score: [...terms(turn.question)].filter(word => query.has(word)).length
  })).filter(item => item.score > 0 && (!anchor || !sameExchange(item.turn, anchor)))
    .sort((a, b) => b.score - a.score || b.index - a.index).slice(0, needsAnchor ? 1 : 2)
    .sort((a, b) => a.index - b.index).map(item => item.turn);
  const selected = [...(needsAnchor ? [anchor] : []), ...related, ...recent];
  return selected.map((turn, index) => ({
    question: turn.question.slice(0, 650),
    answer: turn.answer.slice(0, index === selected.length - 1 ? 3000 : turn === anchor ? 1800 : 850)
  }));
}
