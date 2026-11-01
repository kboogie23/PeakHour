(function () {
  'use strict';

  const existing = window.AxiomStudioDaw || {};

  const pluginKinds = Object.freeze([
    'native-audio-plugin',
    'preset-or-sound-pack',
    'standalone-tool',
    'midi-control-surface',
    'mixed-bundle',
    'unknown',
  ]);

  function createPluginInspectionRecord({ name = '', path = '', kind = 'unknown', notes = '' } = {}) {
    if (pluginKinds.includes(kind) === false) {
      throw new Error('Studio DAW plugin adapter kind is not supported.');
    }
    return {
      name,
      path,
      kind,
      notes,
      readOnlyInspection: true,
      modifiesPluginSource: false,
    };
  }

  window.AxiomStudioDaw = Object.freeze({
    ...existing,
    pluginKinds,
    createPluginInspectionRecord,
  });
})();
