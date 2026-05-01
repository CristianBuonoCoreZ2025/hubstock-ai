import React from 'react';

const InventoryPage: React.FC = () => {
  const mockProducts = [
    { id: 1, name: 'Manzanas', category: 'Frutas', quantity: 50, price: 1.5 },
    { id: 2, name: 'Leche', category: 'Lácteos', quantity: 30, price: 2.0 },
    { id: 3, name: 'Pan', category: 'Panadería', quantity: 20, price: 1.0 },
    { id: 4, name: 'Huevos', category: 'Proteínas', quantity: 100, price: 0.5 },
    { id: 5, name: 'Arroz', category: 'Granos', quantity: 40, price: 1.2 },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Inventario</h1>
      <div className="border rounded-lg p-4">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left p-2">Nombre</th>
              <th className="text-left p-2">Categoría</th>
              <th className="text-left p-2">Cantidad</th>
              <th className="text-left p-2">Precio</th>
            </tr>
          </thead>
          <tbody>
            {mockProducts.map((product) => (
              <tr key={product.id} className="border-b">
                <td className="p-2">{product.name}</td>
                <td className="p-2">{product.category}</td>
                <td className="p-2">{product.quantity}</td>
                <td className="p-2">${product.price.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default InventoryPage;