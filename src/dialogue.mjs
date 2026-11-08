// Recent exchanges resolve short references. An older exchange can still matter
// when the user explicitly returns to a named topic.
export function selectDialogue(turns, question) {
  const recentCount = 4;
  const terms = text => new Set((text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [])
    .filter(word => !/^(?:что|какие|какой|когда|можно|расскажи|объясни|почему|подробнее|пример|ответь|question|please|about|explain)$/u.test(word)));
  const query = terms(question);
  const recent = turns.slice(-recentCount);
  const isFollowUp = text => /^(?:а\b|а\s|и\s|почему\s*[?.!]*$|(?:приведи(?:те)?\s+)?пример|поподробнее|подробнее|what about|and\s)/iu.test(text.trim());
  const anchor = recent.length === recentCount && recent.every(turn => isFollowUp(turn.question))
    ? turns.slice(0, -recentCount).findLast(turn => !isFollowUp(turn.question))
    : undefined;
  const earlier = turns.slice(0, -recentCount).map((turn, index) => ({
    turn, index, score: [...terms(turn.question)].filter(word => query.has(word)).length
  }));
  const related = earlier.filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index).slice(0, anchor ? 1 : 2)
    .sort((a, b) => a.index - b.index).map(item => item.turn);
  const older = turns.slice(0, -recentCount).filter(turn => turn === anchor || related.includes(turn));
  return [...older, ...recent].map((turn, index, selected) => ({
    question: turn.question.slice(0, 650),
    answer: turn.answer.slice(0, index === selected.length - 1 ? 3000 : 850)
  }));
}
