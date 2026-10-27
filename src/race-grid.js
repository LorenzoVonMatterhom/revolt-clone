import * as THREE from "three";

export const OPPONENTS = [
  {id:"volken",name:"Volken Turbo",pace:.92},
  {id:"phat",name:"Phat Slug",pace:.88},
  {id:"cougar",name:"Cougar",pace:.96},
  {id:"tc6",name:"Sprinter XL",pace:.9},
  {id:"sugo",name:"Super Pro",pace:.94},
  {id:"toyeca",name:"Toyeca",pace:.95},
  {id:"adeon",name:"Adeon",pace:.91},
];

// Cars are stored player first. Grid ranks run front to back, player last.
export function makeStartingGrid(setups) {
  const laneSpacing=Math.max(20,...setups.map(s=>Math.max(
    Math.abs(s.center.x)+s.halfExtents.x,
    ...s.wheels.map(w=>Math.abs(w.position.x)+(w.halfWidth??w.radius*.35))
  )*2+4));
  const rowSpacing=Math.max(24,...setups.map(s=>Math.max(
    Math.abs(s.center.z)+s.halfExtents.z,
    ...s.wheels.map(w=>Math.abs(w.position.z)+w.radius)
  )*2+8));
  return setups.map((_,index)=>{
    const rank=index===0?setups.length-1:index-1,row=Math.floor(rank/2),column=rank%2;
    return {rank,row,column,lateral:(column-.5)*laneSpacing,behind:row*rowSpacing+column*3};
  });
}

export function placeStartingGrid(physics,cars,heading) {
  const slots=makeStartingGrid(cars.map(car=>car.setup));
  const forward=new THREE.Vector3(Math.sin(heading),0,Math.cos(heading));
  const right=new THREE.Vector3(forward.z,0,-forward.x);
  const rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),heading);
  // Clear old grid/race positions before placing front-to-back, so stale cars
  // cannot displace other racers or send the player back into the front row.
  cars.forEach(car=>car.body.setEnabled(false));
  try {
    for(const {index} of slots.map((slot,index)=>({...slot,index})).sort((a,b)=>a.rank-b.rank)) {
      const slot=slots[index],position=right.clone().multiplyScalar(slot.lateral).addScaledVector(forward,-slot.behind);
      const floor=physics.groundAt(position,15,80);
      if(floor!==null)position.y=floor;
      if(!physics.placeCar(cars[index],position,rotation))throw new Error('Could not place the starting grid on this track');
      cars[index].body.setEnabled(true);
    }
  } finally {cars.forEach(car=>car.body.setEnabled(true));}
  return slots;
}
