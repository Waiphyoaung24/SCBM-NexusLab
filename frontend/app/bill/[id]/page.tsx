'use client'

import { useUser } from '@/hooks/useUser'
import { supabase } from '@/lib/supabase'
import { ChevronRight, Receipt, Users, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

// ... Interfaces remain the same ...
interface Item {
  id: string
  name: string
  quantity: number
  unit_price: number
  category: string
}
interface Claim {
  item_id: string
  user_id: string
  user_name: string
  percentage: number // Make sure this exists in DB or we default to 1/count
}
interface Bill {
  id: string
  currency: string
  total_amount: number
  tax_amount: number
  tip_amount: number
}

export default function BillPage() {
  const params = useParams()
  const billId = params.id as string
  const { user, registerUser } = useUser()

  const [items, setItems] = useState<Item[]>([])
  const [claims, setClaims] = useState<Claim[]>([])
  const [bill, setBill] = useState<Bill | null>(null)
  const [inputName, setInputName] = useState('')
  const [showSummary, setShowSummary] = useState(false) // <-- New State for Modal

  // ... useEffect for Data Fetching & Realtime remains exactly the same ...
  useEffect(() => {
    if (!billId) return
    const fetchData = async () => {
      const { data: billData } = await supabase.from('bills').select('*').eq('id', billId).single()
      if (billData) setBill(billData)
      const { data: itemsData } = await supabase.from('items').select('*').eq('bill_id', billId).order('unit_price', { ascending: false })
      if (itemsData) setItems(itemsData)
      const { data: claimsData } = await supabase.from('claims').select('*').in('item_id', itemsData?.map(i => i.id) || [])
      if (claimsData) setClaims(claimsData)
    }
    fetchData()
    const channel = supabase.channel('realtime_claims')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'claims' }, (payload) => {
        if (payload.eventType === 'INSERT') setClaims(p => [...p, payload.new as Claim])
        else if (payload.eventType === 'DELETE') setClaims(p => p.filter(c => c.id !== payload.old.id)) 
        // Ideally trigger a re-fetch here to be perfectly safe
        fetchData()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [billId])

  // ... handleClaim remains the same ...
  const handleClaim = async (itemId: string) => {
  if (!user) return;

  // 1. Get the URL from environment variables correctly
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  
  if (!apiUrl) {
    console.error("API URL is not defined in .env.local");
    return;
  }

  try {
    const response = await fetch(`${apiUrl}/v1/bills/${billId}/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': '69420', // Any value works to bypass ngrok landing page
      },
      body: JSON.stringify({ item_id: itemId, user_id: user.id, user_name: user.name })
    });

    if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
    }
  } catch (error) {
    console.error("Network Error:", error);
    alert("Could not connect to server. Check if backend/ngrok is running.");
  }
};

  const getClaimants = (itemId: string) => claims.filter(c => c.item_id === itemId)

  // --- THE NEW MATH LOGIC 🧮 ---
  const myTotals = useMemo(() => {
    if (!user || !bill) return { subtotal: 0, tax: 0, tip: 0, total: 0 }

    let mySubtotal = 0
    let billSubtotal = 0

    items.forEach(item => {
        billSubtotal += item.unit_price
        
        // Calculate my share of this specific item
        const itemClaimants = claims.filter(c => c.item_id === item.id)
        const isMine = itemClaimants.some(c => c.user_id === user.id)
        
        if (isMine) {
            const splitCount = itemClaimants.length
            mySubtotal += (item.unit_price / splitCount)
        }
    })

    // Avoid division by zero
    const ratio = billSubtotal > 0 ? (mySubtotal / billSubtotal) : 0

    const myTax = bill.tax_amount * ratio
    const myTip = bill.tip_amount * ratio

    return {
        subtotal: mySubtotal,
        tax: myTax,
        tip: myTip,
        total: mySubtotal + myTax + myTip
    }
  }, [items, claims, bill, user])

  return (
    <div className="max-w-md mx-auto bg-gray-50 min-h-screen pb-32">
      
      {/* Identity Modal Logic (Same as before) */}
      {!user && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
             {/* ... (Keep your existing identity modal code here) ... */}
             <div className="bg-white rounded-2xl p-6 w-full max-w-xs shadow-2xl">
                <h2 className="text-xl font-bold mb-2 text-center">Who are you?</h2>
                <input autoFocus type="text" className="w-full border p-3 rounded-xl mb-4 text-center" 
                  placeholder="Your Name" value={inputName} onChange={(e) => setInputName(e.target.value)} />
                <button onClick={() => registerUser(inputName)} disabled={!inputName.trim()} 
                  className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold">Join Party</button>
             </div>
        </div>
      )}

      {/* Header (Same as before) */}
      <div className="bg-white px-4 py-4 shadow-sm sticky top-0 z-10 flex justify-between items-center border-b border-gray-100">
        <div className="flex items-center gap-2">
            <div className="bg-blue-100 p-2 rounded-lg"><Receipt className="text-blue-600 w-5 h-5" /></div>
            <div>
                <h1 className="text-lg font-bold leading-tight">Bill Total</h1>
                <p className="text-xs text-gray-500 font-medium">
                    {bill ? `${(bill.total_amount || 0).toLocaleString()} ${bill.currency}` : 'Loading...'}
                </p>
            </div>
        </div>
        <div className="bg-gray-100 px-3 py-1 rounded-full flex items-center gap-1.5">
            <Users className="w-3 h-3 text-gray-500" />
            <span className="text-xs font-bold text-gray-600">{user ? user.name : 'Guest'}</span>
        </div>
      </div>

      {/* Items List (Same as before) */}
      <div className="p-4 space-y-3">
        {items.map((item) => {
          const claimants = getClaimants(item.id)
          const isMine = claimants.some(c => c.user_id === user?.id)
          const splitCount = claimants.length
          const myShare = isMine ? (item.unit_price / splitCount) : 0
          const displayPrice = isMine ? myShare : item.unit_price

          return (
            <button key={item.id} onClick={() => handleClaim(item.id)}
              className={`w-full text-left p-4 rounded-xl shadow-sm border-2 transition-all duration-200 relative overflow-hidden
                ${isMine ? 'bg-blue-50/80 border-blue-500' : 'bg-white border-transparent hover:border-blue-200'}`}>
              <div className="flex justify-between items-start relative z-10">
                <div className="flex-1 pr-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`font-semibold text-lg ${isMine ? 'text-blue-900' : 'text-gray-900'}`}>
                        {item.name}
                    </span>
                    {item.quantity > 1 && <span className="text-[10px] bg-gray-200 px-1.5 py-0.5 rounded text-gray-700 font-bold">x{item.quantity}</span>}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2 h-6">
                    {claimants.map((c, i) => (
                        <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full font-bold border
                            ${c.user_id === user?.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300'}`}>
                            {c.user_name}
                        </span>
                    ))}
                  </div>
                </div>
                <div className="text-right">
                  <p className={`font-bold text-lg ${isMine ? 'text-blue-600' : 'text-gray-900'}`}>
                    {displayPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                  {isMine && splitCount > 1 && <div className="text-[10px] text-blue-500 font-bold bg-blue-100 px-1 rounded inline-block">SPLIT {splitCount}</div>}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* --- FLOATING CHECKOUT BUTTON --- */}
      <div className="fixed bottom-6 left-4 right-4 z-20">
        <button 
            onClick={() => setShowSummary(true)}
            className="w-full bg-black text-white py-4 rounded-2xl font-bold text-lg shadow-xl shadow-gray-300 active:scale-95 transition-transform flex justify-between px-6 items-center"
        >
            <span>View My Total</span>
            <div className="flex items-center gap-3">
                <span className="text-sm font-normal opacity-80">{myTotals.total.toLocaleString(undefined, { maximumFractionDigits: 0 })} {bill?.currency}</span>
                <span className="bg-white/20 px-3 py-1 rounded-lg text-sm">{claims.filter(c => c.user_id === user?.id).length} Items</span>
            </div>
        </button>
      </div>

      {/* --- SUMMARY MODAL (THE FINAL PIECE) --- */}
      {showSummary && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pointer-events-none">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-auto" onClick={() => setShowSummary(false)} />
            
            {/* Modal Content */}
            <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 pointer-events-auto relative animate-in slide-in-from-bottom-10">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold">Your Share</h2>
                    <button onClick={() => setShowSummary(false)} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Receipt Paper Effect */}
                <div className="bg-gray-50 p-6 rounded-xl border border-dashed border-gray-300 mb-6 space-y-3">
                    <div className="flex justify-between text-gray-600">
                        <span>Items Subtotal</span>
                        <span>{myTotals.subtotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    </div>
                    
                    {/* Only show tax/tip if they exist */}
                    {myTotals.tax > 0 && (
                        <div className="flex justify-between text-gray-500 text-sm">
                            <span>Tax ({(myTotals.tax / myTotals.subtotal * 100).toFixed(0)}% Share)</span>
                            <span>{myTotals.tax.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        </div>
                    )}
                    {myTotals.tip > 0 && (
                        <div className="flex justify-between text-gray-500 text-sm">
                            <span>Service/Tip</span>
                            <span>{myTotals.tip.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        </div>
                    )}

                    <div className="border-t border-gray-300 pt-3 flex justify-between items-end">
                        <span className="font-bold text-lg">Total Due</span>
                        <div className="text-right">
                             <span className="block font-black text-3xl text-blue-600">
                                {myTotals.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                             </span>
                             <span className="text-xs text-gray-400 font-bold">{bill?.currency}</span>
                        </div>
                    </div>
                </div>

                {/* Call to Action */}
                <button className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors">
                    Pay Now
                    <ChevronRight className="w-5 h-5" />
                </button>
                <p className="text-center text-xs text-gray-400 mt-3">
                    Payments powered by Stripe (Demo Mode)
                </p>
            </div>
        </div>
      )}

    </div>
  )
}