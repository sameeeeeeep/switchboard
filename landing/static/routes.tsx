import FreehandLanding from '../app/v2/site';
import Developers from '../app/developers/page';
import { metadata as homeMeta } from '../app/v2/page';
import { metadata as devMeta } from '../app/developers/page';
import '../app/globals.css';

export const routes = [
  { path: '/', out: 'index.html', Page: FreehandLanding, title: String(homeMeta.title), description: String(homeMeta.description) },
  { path: '/developers/', out: 'developers/index.html', Page: Developers, title: String(devMeta.title), description: String(devMeta.description) },
];
export function pick(pathname: string) {
  const p = pathname.replace(/^\/switchboard/, '').replace(/index\.html$/, '') || '/';
  return routes.find(r => r.path === (p.endsWith('/') ? p : p + '/')) ?? routes[0];
}
