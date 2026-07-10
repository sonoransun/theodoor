/**
 * music/analysis — WAV → MusicalTimeline analysis pipeline.
 *
 * decodeWav → stft → (spectral-flux onsets, A-weighted energy) →
 * tempo/beat-grid estimation → annotations. `analyzeWav`/`analyzePcm` are the
 * top-level entry points; the stages are exported for reuse and testing.
 */

export { decodeWav } from './wav.js'
export type { DecodedWav } from './wav.js'
export { fft, hann, stft, STFT_SIZE, STFT_HOP } from './fft.js'
export { detectOnsets } from './onset.js'
export type { OnsetPoint, OnsetResult, OnsetOptions } from './onset.js'
export { estimateTempo } from './tempoEst.js'
export type { TempoEstimate, TempoEstimateOptions } from './tempoEst.js'
export { computeEnergy, aWeightDb } from './energy.js'
export type { EnergyOptions } from './energy.js'
export { analyzePcm, analyzeWav } from './annotate.js'
export type { AnalyzeOptions } from './annotate.js'
