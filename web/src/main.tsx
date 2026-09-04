import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { CaretakerApp } from './CaretakerApp';
import { ResidentApp } from './ResidentApp';
import { resolveWebScreen } from './route';
import './styles.css';

const screen = resolveWebScreen(window.location.pathname);
const Screen = screen === 'admin' ? App : screen === 'caretaker' ? CaretakerApp : ResidentApp;

createRoot(document.getElementById('root')!).render(<StrictMode><Screen /></StrictMode>);
