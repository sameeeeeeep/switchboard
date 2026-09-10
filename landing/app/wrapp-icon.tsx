export function WrappIcon({ name, className = '', eager = false }: { name: string; className?: string; eager?: boolean }) {
  return <img className={'wrapp-icon ' + className} src={'/wrapps/' + name + '.png'} width="40" height="40" alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" />;
}
