function fitOverlay(bounds, area, naturalHeight) {
  const maxHeight = Math.max(220, area.height - 24);
  const height = Math.max(220, Math.min(maxHeight, Math.ceil(naturalHeight)));
  const width = Math.min(bounds.width, Math.max(420, area.width - 24));
  return { bounds: { width, height, x: Math.max(area.x + 12, Math.min(bounds.x, area.x + area.width - width - 12)), y: Math.max(area.y + 12, Math.min(bounds.y, area.y + area.height - height - 12)) }, maxHeight, limited: naturalHeight > maxHeight };
}
module.exports = { fitOverlay };
