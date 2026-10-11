// Owner: K0. /assets-dev.html?family=kenney → Kenney previews (see ./sampler.ts, ./vignette.ts).
//   (default)        sampler rows: our bus/people/kit pieces next to recoloured Kenney cars, trees, rocks, props,
//                    buildings, boats, then every kn.* catalog kind through the registry. &row=N&u=0 zooms a row.
//   &scene=vignette  one small diorama: our bus + people on a kit road among Kenney trees, rocks, house, cars,
//                    boats and props (the scale/palette check). Both: &p=a|b|c palette, &still=1 for screenshots.
const scene = new URLSearchParams(location.search).get('scene');
if (scene === 'vignette') await import('./vignette');
else await import('./sampler');
export {};
