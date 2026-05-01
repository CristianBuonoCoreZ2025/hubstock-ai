import React from 'react';

const SupermarketPage: React.FC = () => {
  const mockSupermarkets = [
    { id: 1, name: 'Supermercado A', location: 'Calle 123', products: 150 },
    { id: 2, name: 'Supermercado B', location: 'Avenida 456', products: 200 },
    { id: 3, name: 'Supermercado C', location: 'Plaza 789', products: 180 },
    { id: 4, name: 'Supermercado D', location: 'Callejón 101', products: 120 },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Supermercado</h1>
      <div className="border rounded-lg p-4">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left p-2">Nombre</th>
              <th className="text-left p-2">Ubicación</th>
              <th className="text-left p-2">Productos</th>
            </tr>
          </thead>
          <tbody>
            {mockSupermarkets.map((supermarket) => (
              <tr key={supermarket.id} className="border-b">
                <td className="p-2">{supermarket.name}</td>
                <td className="p-2">{supermarket.location}</td>
                <td className="p-2">{supermarket.products}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SupermarketPage;