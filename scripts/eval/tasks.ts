// Synthetic task state is judged outside the model. Seeds vary labels, values,
// layout order, and delays for repeatable task variations.
export interface BrowserTask { id: string; goal: string; html: string; setup: string; success: string }
export const taskFamilies = ['context-click', 'form-fill', 'select', 'checkbox', 'delayed-editor'] as const;
export type TaskFamily = typeof taskFamilies[number];
export function browserTask(family: TaskFamily, seed: number): BrowserTask {
  const names = ['Cedar', 'Maple', 'Willow', 'Birch', 'Aspen', 'Juniper', 'Elm'];
  const wanted = names[Math.abs(seed) % names.length];
  const other = names[(Math.abs(seed) + 1) % names.length];
  const value = `draft-${Math.abs(seed)}`;
  const quoted = JSON.stringify(value);
  const base = { id: `${family}:${seed}` };
  switch (family) {
    case 'context-click': {
      const groups = [wanted, other];
      if (seed % 2) groups.reverse();
      return { ...base, goal: `Save the ${wanted} project, leaving the ${other} project untouched.`,
        html: groups.map(name => `<form aria-label="${name} project"><h2>${name}</h2><button type="button">Save</button><output></output></form>`).join(''),
        setup: `for (const form of document.querySelectorAll('form')) form.querySelector('button').onclick=()=>{form.querySelector('output').textContent='Saved';form.dataset.count=String(Number(form.dataset.count||0)+1)}`,
        success: `document.querySelector('form[aria-label="${wanted} project"]').dataset.count==='1' && !document.querySelector('form[aria-label="${other} project"]').dataset.count` };
    }
    case 'form-fill': return { ...base, goal: `Enter ${value} into the ${wanted} draft field. Leave the ${other} draft unchanged. Do not submit.`,
      html: `<label>${other} draft<input value="keep"></label><label>${wanted} draft<input></label>`, setup: '',
      success: `document.querySelectorAll('input')[0].value==='keep' && document.querySelectorAll('input')[1].value===${quoted}` };
    case 'select': return { ...base, goal: `Set the destination to ${wanted}.`,
      html: `<label>Destination<select><option value="">Choose</option><option>${other}</option><option>${wanted}</option></select></label>`, setup: '',
      success: `document.querySelector('select').value===${JSON.stringify(wanted)}` };
    case 'checkbox': return { ...base, goal: `Enable ${wanted} alerts. Keep ${other} alerts disabled.`,
      html: `<label><input type="checkbox">${other} alerts</label><label><input type="checkbox">${wanted} alerts</label>`, setup: '',
      success: `!document.querySelectorAll('input')[0].checked && document.querySelectorAll('input')[1].checked` };
    case 'delayed-editor': return { ...base, goal: `Open the editor and write ${value} into Draft. Do not submit.`,
      html: '<button>Open editor</button><div role="status"></div>',
      setup: `document.querySelector('button').onclick=()=>{document.querySelector('[role=status]').textContent='Loading';setTimeout(()=>{document.querySelector('[role=status]').textContent='Ready';document.body.insertAdjacentHTML('beforeend','<label>Draft<input></label>')},${500 + Math.abs(seed % 4) * 300})}`,
      success: `document.querySelector('input')?.value===${quoted}` };
  }
}
