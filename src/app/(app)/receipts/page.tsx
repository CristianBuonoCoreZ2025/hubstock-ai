import React from 'react';

const ReceiptsPage: React.FC = () => {
  const mockReceipts = [
    { id: 1, date: '2023-10-01', total: 50.0, items: 5 },
    { id: 2, date: '2023-10-02', total: 75.5, items: 7 },
    { id: 3, date: '2023-10-03', total: 30.2, items: 3 },
    { id: 4, date: '2023-10-04', total: 120.0, items: 12 },
    { id: 5, date: '2023-10-05', total: 45.75, items: 4 },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Boletas</h1>
      <div className="border rounded-lg p-4">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left p-2">Fecha</th>
              <th className="text-left p-2">Total</th>
              <th className="text-left p-2">Artículos</th>
            </tr>
          </thead>
          <tbody>
            {mockReceipts.map((receipt) => (
              <tr key={receipt.id} className="border-b">
                <td className="p-2">{receipt.date}</td>
                <td className="p-2">${receipt.total.toFixed(2)}</td>
                <td className="p-2">{receipt.items}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ReceiptsPage;