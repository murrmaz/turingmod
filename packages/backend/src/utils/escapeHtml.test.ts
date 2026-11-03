import { describe, expect, it } from 'vitest';
import { escapeHtml } from './escapeHtml.js';

describe('escapeHtml', () => {
  it('escapes the characters that can open a tag or an attribute', () => {
    expect(escapeHtml(`<script>alert("x" & 'y')</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;'
    );
  });

  it('leaves ordinary text alone', () => {
    expect(escapeHtml('access_denied: The user denied the request')).toBe(
      'access_denied: The user denied the request'
    );
  });
});
