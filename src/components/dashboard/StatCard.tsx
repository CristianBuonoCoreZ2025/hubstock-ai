import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface StatCardProps {
  title: string
  value: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}

const StatCard: React.FC<StatCardProps> = ({ title, value, description, icon: Icon }) => {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle>{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-xl font-semibold tabular-nums tracking-tight text-foreground">{value}</div>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  )
}

export default StatCard
