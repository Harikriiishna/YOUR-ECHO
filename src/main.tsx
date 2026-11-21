import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {applyThemeToDocument, getSavedThemeId} from './lib/themes.ts';

applyThemeToDocument(getSavedThemeId());

createRoot(document.getElementById('root')!).render(<App />);
