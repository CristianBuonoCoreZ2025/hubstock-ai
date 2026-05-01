import { redirect } from 'next/navigation';

const HomePage = () => {
  redirect('/dashboard');

  return null;
};

export default HomePage;