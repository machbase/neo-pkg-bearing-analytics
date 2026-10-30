import { render } from 'preact/compat';
import { html } from './html.js';
import './styles/colors.css';
import './styles/typography.css';
import './styles/spacing.css';
import './styles/effects.css';
import './styles/theme-light.css';
import './styles/base.css';
import './styles/hover.css';
import { App } from './app.js';
import { initLang } from './i18n.js';

initLang();

render(
  html`<${App} defaultTab="monitor" defaultTheme="dark" seed=${42} equipmentCount=${20} />`,
  document.getElementById('app')
);
