// World preset definitions, preset applier, and planetary warning display.
import { state } from '../core/state.js';

export const WORLD_PRESETS = {
    earth:    { gravity: 1.0, worldSize: 1.0, atm: 3, hydro: 3, baseTemp:   15, tilt: 23 },
    arid:     { gravity: 1.0, worldSize: 1.0, atm: 2, hydro: 1, baseTemp:   40, tilt: 25 },
    mars:     { gravity: 0.4, worldSize: 0.5, atm: 1, hydro: 0, baseTemp:  -60, tilt: 25 },
    venus:    { gravity: 0.9, worldSize: 1.0, atm: 5, hydro: 0, baseTemp:  460, tilt:  3 },
    ocean:    { gravity: 1.0, worldSize: 1.0, atm: 3, hydro: 5, baseTemp:   20, tilt: 20 },
    highgrav: { gravity: 2.5, worldSize: 2.0, atm: 3, hydro: 3, baseTemp:   15, tilt: 23 },
    iceball:  { gravity: 0.8, worldSize: 0.8, atm: 2, hydro: 2, baseTemp:  -80, tilt: 15 },
    titan:    { gravity: 0.1, worldSize: 0.4, atm: 4, hydro: 2, baseTemp: -180, tilt: 27 },
    deadrock: { gravity: 0.5, worldSize: 0.3, atm: 0, hydro: 0, baseTemp:    0, tilt: 10 },
};

/** Show constraint warnings for implausible planetary parameter combinations. */
export function updatePlanetWarnings() {
    const el = document.getElementById('planetWarning');
    if (!el) return;
    const atm  = +(document.getElementById('sAtm')?.value      ?? 3);
    const hydro = +(document.getElementById('sHydro')?.value   ?? 3);
    const temp = +(document.getElementById('sBaseTemp')?.value ?? 15);
    const grav = +(document.getElementById('sGravity')?.value  ?? 1.0);
    const tilt = +(document.getElementById('sTilt')?.value     ?? 23);

    // Priority: errors first, then warnings
    if (atm === 0 && hydro >= 2) {
        el.textContent = '\u26A0 No atmosphere \u2014 surface liquids would instantly vaporize. Hydrosphere produces no weather or oceans.';
        el.className = 'planet-warning error';
    } else if (atm >= 4 && grav <= 0.3) {
        el.textContent = '\u26A0 A thick atmosphere on a very low-gravity world is unlikely to be retained \u2014 it would escape to space over geological time.';
        el.className = 'planet-warning warn';
    } else if (temp >= 150 && hydro >= 3 && atm <= 3) {
        el.textContent = '\u26A0 At these temperatures, liquid water boils away under normal pressure. Only a crushing atmosphere could keep it liquid.';
        el.className = 'planet-warning warn';
    } else if (tilt >= 60) {
        el.textContent = '\u2139 Extreme axial tilt causes severe seasons \u2014 polar regions alternate between months of constant sunlight and total darkness.';
        el.className = 'planet-warning warn';
    } else {
        el.textContent = '';
        el.className = 'planet-warning';
    }
}

/**
 * Apply a named world preset to the five Planetary Physics sliders.
 * 'random' picks alien-range values randomly.
 */
export function applyPreset(name) {
    let p = WORLD_PRESETS[name];
    if (!p) {
        if (name === 'random') {
            const gravList = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.2, 1.5, 1.8, 2.0, 2.5];
            const tempList = [-150, -100, -80, -60, -40, -20, 0, 30, 60, 100, 150, 200, 300, 400, 460];
            p = {
                gravity:  gravList[Math.floor(Math.random() * gravList.length)],
                atm:      Math.floor(Math.random() * 6),
                hydro:    Math.floor(Math.random() * 5),
                baseTemp: tempList[Math.floor(Math.random() * tempList.length)],
                tilt:     Math.floor(Math.random() * 81),
            };
        } else {
            return;
        }
    }
    const map = { sGravity: p.gravity, sWorldSize: p.worldSize ?? 1.0, sAtm: p.atm, sHydro: p.hydro, sBaseTemp: p.baseTemp, sTilt: p.tilt };
    for (const [id, val] of Object.entries(map)) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.value = val;
        el.dispatchEvent(new Event('input'));
    }
    // input events above reset the dropdown to 'custom'; restore the preset label (random stays 'custom')
    const wp = document.getElementById('worldPreset');
    if (wp && name !== 'random') wp.value = name;
    state.currentPreset = (name !== 'random') ? name : 'custom';
}
