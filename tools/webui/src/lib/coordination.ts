// Browser-owned locks are released automatically when a tab crashes/closes.
export async function withStudioLock<T>(work: () => Promise<T>): Promise<{ acquired: boolean; value?: T }> {
 if (!navigator.locks) throw new Error('This browser cannot coordinate safe saves. Open Studio in an up-to-date browser on localhost.');
 return navigator.locks.request('yue2-studio-operation', {mode:'exclusive',ifAvailable:true}, async lock => lock ? {acquired:true,value:await work()} : {acquired:false});
}
