// Owner: G1. Preview: /greater-highway-dev.html (see the header of ./index.ts for flags).
import { gallery } from './gallery';

const q = new URLSearchParams(location.search);
const msg = document.getElementById('msg')!;
const canvas = document.getElementById('c') as HTMLCanvasElement;
if (q.get('gallery') === '1') gallery(canvas, msg).catch((e) => { msg.textContent = `error: ${(e as Error).message}`; });
