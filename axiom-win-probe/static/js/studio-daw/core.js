(function () {
  'use strict';

  const existing = window.AxiomStudioDaw || {};

  const boundaries = Object.freeze({
    productName: 'AXIOM Studio DAW',
    ownsTimelineState: true,
    mutatesSourceAudio: false,
    writesExternalDjDatabases: false,
    usesCurrentPlaylistInternals: false,
  });

  function createEmptyProject(title = 'Untitled Studio DAW Project', bpm = 120) {
    return {
      schemaVersion: 1,
      title,
      tempoSegments: [{ startBeat: 0, bpm }],
      beatgridReferences: [],
      automationLanes: [],
      decks: [],
      externalPublishEnabled: false,
      sourceAudioMutationEnabled: false,
    };
  }

  window.AxiomStudioDaw = Object.freeze({
    ...existing,
    boundaries,
    createEmptyProject,
  });
})();
