let _map = {}

export function setCustomEmojiMap(map) { _map = map }
export function getCustomEmojiUrl(shortcode) { return _map[shortcode] || null }
