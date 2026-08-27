export const euros = (v) =>
  new Intl.NumberFormat('pt-PT', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(v ?? 0) + 'M';

export const sinal = (v) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1));

const ROTULOS = {
  fora: 'Fora',
  lesao: 'Lesionado',
  castigo: 'Castigado',
  duvida: 'Em dúvida',
};

export const rotulo = (tipo) => ROTULOS[tipo] ?? 'Indisponível';

export const espinha = (tipo) => (tipo === 'duvida' ? 'duvida' : 'fora');

export function contagem(iso) {
  if (!iso) return null;
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return { texto: 'mercado fechado', urgente: true };
  const horas = Math.floor(ms / 36e5);
  const minutos = Math.floor((ms % 36e5) / 6e4);
  if (horas >= 48) return { texto: `${Math.floor(horas / 24)} dias`, urgente: false };
  return { texto: `${horas}h ${String(minutos).padStart(2, '0')}m`, urgente: horas < 12 };
}
