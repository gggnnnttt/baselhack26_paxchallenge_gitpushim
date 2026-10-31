import { Pipe, PipeTransform } from '@angular/core';
import { renderMarkdown } from './markdown-renderer';

@Pipe({ name: 'markdown', standalone: true })
export class MarkdownPipe implements PipeTransform {
  transform(content: string): string {
    return renderMarkdown(content);
  }
}