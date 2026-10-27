// Standalone entry for the mowing prototype (mow.html).
import { mountMow } from './mountMow';

mountMow(document.getElementById('app')!, {
  onFinish: (run) => console.info('[stripes] finished', { ...run, inputs: `${run.inputs.length / 5} input runs` }),
});
