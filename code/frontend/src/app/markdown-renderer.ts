import { Marked } from 'marked';

const markdown = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    // Treat embedded HTML as text; Angular also sanitizes the final HTML binding.
    html: ({ text }) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  },
});

export function renderMarkdown(content: string): string {
  return markdown.parse(content, { async: false });
}