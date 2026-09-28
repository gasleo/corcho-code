import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { migrateLegacyStorage } from './storage';
import './styles.css';

// Antes de montar nada: los lectores de tema, colores y paneles corren en el
// primer render y tienen que encontrar las claves con el nombre nuevo.
migrateLegacyStorage();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
