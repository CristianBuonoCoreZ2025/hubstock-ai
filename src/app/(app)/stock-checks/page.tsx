import React from 'react';

const StockChecksPage: React.FC = () => {
  const mockStockChecks = [
    { id: 1, date: '2023-10-01', product: 'Manzanas', quantity: 50, status: 'Completado' },
    { id: 2, date: '2023-10-02', product: 'Leche', quantity: 30, status: 'Pendiente' },
    { id: 3, date: '2023-10-03', product: 'Pan', quantity: 20, status: 'Completado' },
    { id: 4, date: '2023-10-04', product: 'Huevos', quantity: 100, status: 'Completado' },
    { id: 5, date: '2023-10-05', product: 'Arroz', quantity: 40, status: 'Pendiente' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Cheques de stock</h1>
      <div className="border rounded-lg p-4">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left p-2">Fecha</th>
              <th className="text-left p-2">Producto</th>
              <th className="text-left p-2">Cantidad</th>
              <th className="text-left p-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {mockStockChecks.map((check) => (
              <tr key={check.id} className="border-b">
                <td className="p-2">{check.date}</td>
                <td className="p-2">{check.product}</td>
                <td className="p-2">{check.quantity}</td>
                <td className="p-2">{check.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StockChecksPage;