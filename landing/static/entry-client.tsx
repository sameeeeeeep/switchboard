import { hydrateRoot } from 'react-dom/client';
import { pick } from './routes';
const { Page } = pick(location.pathname);
hydrateRoot(document.getElementById('root')!, <Page />);
