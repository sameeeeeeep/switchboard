import { renderToString } from 'react-dom/server';
import { routes } from './routes';
export function render(path: string) {
  const r = routes.find(x => x.path === path)!;
  return { html: renderToString(<r.Page />), title: r.title, description: r.description };
}
export { routes };
