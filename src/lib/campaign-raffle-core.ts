export const RAFFLE_MIN_NUMBER = 1;
export const RAFFLE_MAX_NUMBER = 10_000;

export function drawUniqueRaffleNumbers({
  min = RAFFLE_MIN_NUMBER,
  max = RAFFLE_MAX_NUMBER,
  usedNumbers,
  count,
  nextIndex
}: {
  min?: number;
  max?: number;
  usedNumbers: Iterable<number>;
  count: number;
  nextIndex: (maxExclusive: number) => number;
}) {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > RAFFLE_MAX_NUMBER) {
    throw new Error("Faixa de números inválida.");
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("A quantidade de tickets deve ser maior que zero.");
  }

  const used = new Set(Array.from(usedNumbers).filter((number) => Number.isInteger(number) && number >= min && number <= max));
  const available = Array.from({ length: max - min + 1 }, (_, index) => min + index).filter((number) => !used.has(number));
  if (count > available.length) {
    throw new Error(`Existem apenas ${available.length} tickets disponíveis nesta campanha.`);
  }

  const selected: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const selectedIndex = nextIndex(available.length);
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= available.length) {
      throw new Error("O gerador aleatório retornou uma posição inválida.");
    }
    selected.push(available[selectedIndex]);
    available[selectedIndex] = available[available.length - 1];
    available.pop();
  }
  return selected;
}

export function raffleConfirmationText(totalTickets: number) {
  return `DISTRIBUIR ${totalTickets}`;
}

export function formatRaffleNumber(number: number) {
  return String(number).padStart(5, "0");
}
