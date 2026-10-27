// Standalone dev/demo entry. Shepherd uses src/embed instead.
import { mountGame } from './embed';

mountGame(document.getElementById('app')!, {
  onFinish: (run) => console.info('[blown-away] finished', { ...run, inputs: `${run.inputs.length / 5} input runs` }),
});
