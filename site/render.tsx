import React from 'react';
import { renderToString } from 'react-dom/server';
import PublicPage from './PublicPage';
export { PUBLIC_PAGES, PROJECT, DOCS, FAQ } from './content';
export function renderPage(path: string) { return renderToString(<React.StrictMode><PublicPage path={path} /></React.StrictMode>); }
