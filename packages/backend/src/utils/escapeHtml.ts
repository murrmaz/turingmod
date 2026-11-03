const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Make text safe to place in HTML: in an element's text, or in a quoted attribute. It often isn't
 * ours: the OAuth callback page shows a provider's error, which comes from the URL and so from
 * whoever made the link, and a clip page shows titles viewers wrote.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}
