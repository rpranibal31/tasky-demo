/** Un segmento por Tasker requerido: cuánto falta para cubrir el turno se lee
 *  de un vistazo, que es la pregunta que importa en operaciones. */
export function Meter({
  needed,
  confirmed,
  className = "",
}: {
  needed: number;
  confirmed: number;
  className?: string;
}) {
  return (
    <div
      className={`flex gap-[3px] ${className}`}
      role="meter"
      aria-valuenow={confirmed}
      aria-valuemin={0}
      aria-valuemax={needed}
      aria-label={`${confirmed} de ${needed} Taskers confirmados`}
    >
      {Array.from({ length: needed }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 flex-1 rounded-[1px] ${i < confirmed ? "bg-moss" : "bg-hairline"}`}
        />
      ))}
    </div>
  );
}
