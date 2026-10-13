#!/usr/bin/env node
import { createApp } from './app.js';
const port = Number(process.env.PORT || 3050);
const seedRaw = process.env.SEED || '42';
createApp({ seed: /^\d+$/.test(seedRaw) ? Number(seedRaw) : seedRaw }).listen(port, () => console.log(`listening on http://localhost:${port}`));
