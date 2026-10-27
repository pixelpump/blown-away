// Standalone entry for Garden Plot (plot.html).
import { mountPlot } from './mountPlot';

mountPlot(document.getElementById('app')!, {
  onFinish: (r) => console.info('[garden-plot] solved', r),
});
