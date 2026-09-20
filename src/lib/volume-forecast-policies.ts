/** Central, versioned LOB policies. No client or report can select a different model.
 * Compared against 167 configurations; August selection and separate Aug 31–Sep 16 validation.
 * Do not replace an incumbent with a challenger that fails the separate validation.
 */
export const VOLUME_FORECAST_POLICIES = {
  ADS: {
    id: "report-ensemble",
    label: "ADS · ensemble ajustado ao volume recente",
    rationale:
      "Best joint daily/hourly score in selection; retained in the separate validation.",
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
