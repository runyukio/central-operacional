/** Central, versioned LOB policies. No client or report can select a different model.
 * The original 167-model comparison and the later ADS anomaly review are documented
 * separately. Changes require time-separated retrospective checks, not a desired total.
 */
export const VOLUME_FORECAST_POLICIES = {
  ADS: {
    id: "ads-seasonal-damped",
    label: "ADS · sazonalidade semanal e tendência amortecida",
    rationale:
      "Damp duplicate recent amplification and blend weekends with a robust weekday reference; reviewed across retrospective periods and horizons, with remaining spike risk.",
  },
  VIDEO: {
    id: "daily-3-h0-profile-120-all",
    label: "Vídeo · volume de 3 dias × perfil horário longo",
    rationale:
      "More stable intraday distribution; improves joint score on separate validation, with a small daily-total tradeoff.",
  },
  COMMENTS: {
    id: "weekday-28d-h7",
    label: "Comments · dia da semana e hora, ponderado em 4 semanas",
    rationale:
      "Retained: the long-window challenger selected in August regressed on both daily and hourly metrics in separate validation.",
  },
} as const;
export type ForecastPolicyLob = keyof typeof VOLUME_FORECAST_POLICIES;
