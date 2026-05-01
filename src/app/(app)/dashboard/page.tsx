import React from 'react';
import StatCard from '../../../components/dashboard/StatCard';
import QuickActionCard from '../../../components/dashboard/QuickActionCard';
import { Package, ShoppingCart, Store, FileText,  Plus } from 'lucide-react';

const DashboardPage: React.FC = () => {
 
   const mockData = {
    inventory: 1234,
    sales: 456,
    supermarkets: 12,
    receipts: 78,
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Productos en inventario"
          value={mockData.inventory.toString()}
          description="Total de productos"
          icon={Package}
        />
        <StatCard
          title="Ventas hoy"
          value={`$${mockData.sales}`}
          description="Ventas totales"
          icon={ShoppingCart}
        />
        <StatCard
          title="Supermercados"
          value={mockData.supermarkets.toString()}
          description="Supermercados registrados"
          icon={Store}
        />
        <StatCard
          title="Boletas"
          value={mockData.receipts.toString()}
          description="Boletas generadas"
          icon={FileText}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <QuickActionCard
          title="Agregar producto"
          description="Agrega un nuevo producto a tu inventario"
          icon={Plus}
          actionText="Agregar producto"
          href="/inventory"
         />
        <QuickActionCard
          title="Crear lista"
          description="Crea una nueva lista de compras"
          icon={Plus}
          actionText="Crear lista"
          href="/shopping-list"
        />
      </div>
    </div>
  );
};

export default DashboardPage;